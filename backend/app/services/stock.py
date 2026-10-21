"""Stock changes. The only way stock_qty changes is a stock movement, applied in the same transaction.

When a product has variants (for example cover colours), every movement names one, and the product's
stock is kept equal to the sum of its variants. Stock never goes below zero.
"""

import uuid

from sqlalchemy import select, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from app.core.permissions import Role
from app.core.security import utcnow
from app.models import LowStockFlag, Product, ProductVariant, Staff, StockMovement
from app.services import audit
from app.services.context import RequestContext
from app.services.errors import ServiceError

ADJUST_REASONS = ("adjusted", "damaged", "returned")


def _check_variant(product: Product, variant: ProductVariant | None) -> None:
    if product.variants and variant is None:
        raise ServiceError("Choose which option this stock is for.", code="variant_required")
    if variant is not None and variant.product_id != product.id:
        raise ServiceError("That option belongs to another product.", code="variant_mismatch")


def _apply(db: Session, model, row_id: uuid.UUID, change_qty: int) -> int | None:
    """Adds change_qty in SQL so two changes at once can't overwrite each other. None if it would go below zero."""
    return db.execute(
        update(model)
        .where(model.id == row_id, model.stock_qty + change_qty >= 0)
        .values(stock_qty=model.stock_qty + change_qty)
        .returning(model.stock_qty)
    ).scalar_one_or_none()


def record_movement(
    db: Session,
    product: Product,
    change_qty: int,
    reason: str,
    *,
    variant: ProductVariant | None = None,
    staff_id: uuid.UUID | None = None,
    order_id: uuid.UUID | None = None,
    supplier: str | None = None,
    unit_cost_rwf: int | None = None,
    note: str | None = None,
) -> StockMovement:
    _check_variant(product, variant)

    if variant is not None:
        new_variant_qty = _apply(db, ProductVariant, variant.id, change_qty)
        if new_variant_qty is None:
            raise ServiceError(
                f"There are only {variant.stock_qty} of {variant.name} in stock.", code="not_enough_stock"
            )
        set_committed_value(variant, "stock_qty", new_variant_qty)
    new_qty = _apply(db, Product, product.id, change_qty)
    if new_qty is None:
        raise ServiceError(f"There are only {product.stock_qty} in stock.", code="not_enough_stock")
    set_committed_value(product, "stock_qty", new_qty)

    movement = StockMovement(
        product_id=product.id,
        variant_id=variant.id if variant else None,
        change_qty=change_qty,
        reason=reason,
        staff_id=staff_id,
        order_id=order_id,
        supplier=supplier,
        unit_cost_rwf=unit_cost_rwf,
        note=note,
    )
    db.add(movement)
    if not product.is_low:
        clear_low_stock_flag(db, product.id)
    db.flush()
    return movement


def _label(product: Product) -> str:
    return f"SKU {product.sku}"


def receive(
    db: Session,
    actor: Staff,
    product: Product,
    qty: int,
    *,
    variant: ProductVariant | None,
    supplier: str | None,
    unit_cost_rwf: int | None,
    note: str | None,
    context: RequestContext,
) -> StockMovement:
    """A delivery. The product's cost price is not changed; the delivery's cost is kept on the movement."""
    if qty <= 0:
        raise ServiceError("Enter how many arrived.", code="invalid_quantity")
    before = product.stock_qty
    movement = record_movement(
        db, product, qty, "received",
        variant=variant, staff_id=actor.id, supplier=supplier, unit_cost_rwf=unit_cost_rwf, note=note,
    )
    audit.record(
        db, actor, "stock.received",
        entity_type="product", entity_id=product.id, entity_label=_label(product),
        before={"stock_qty": before},
        after={
            "stock_qty": product.stock_qty, "received": qty, "variant": variant.name if variant else None,
            "supplier": supplier, "unit_cost_rwf": unit_cost_rwf,
        },
        context=context,
    )
    return movement


def adjust(
    db: Session,
    actor: Staff,
    product: Product,
    change_qty: int,
    reason: str,
    *,
    variant: ProductVariant | None,
    note: str,
    context: RequestContext,
) -> StockMovement:
    """A correction that is not a sale or a delivery: a stock count, damage, or a return."""
    if reason not in ADJUST_REASONS:
        raise ServiceError("Choose why the stock is changing.", code="invalid_reason")
    if change_qty == 0:
        raise ServiceError("Enter how much the stock changes by.", code="invalid_quantity")
    if reason == "damaged" and change_qty > 0:
        raise ServiceError("Damaged stock can only go down.", code="invalid_quantity")
    if reason == "returned" and change_qty < 0:
        raise ServiceError("Returned stock can only go up.", code="invalid_quantity")
    if not note.strip():
        raise ServiceError("Add a note saying why.", code="note_required")

    before = product.stock_qty
    movement = record_movement(
        db, product, change_qty, reason, variant=variant, staff_id=actor.id, note=note.strip()
    )
    audit.record(
        db, actor, "stock.adjusted",
        entity_type="product", entity_id=product.id, entity_label=_label(product),
        before={"stock_qty": before},
        after={
            "stock_qty": product.stock_qty, "change": change_qty, "reason": reason,
            "variant": variant.name if variant else None, "note": note.strip(),
        },
        context=context,
    )
    return movement


def open_low_stock_flag(db: Session, product_id: uuid.UUID) -> LowStockFlag | None:
    return db.scalar(
        select(LowStockFlag).where(LowStockFlag.product_id == product_id, LowStockFlag.cleared_at.is_(None))
    )


def clear_low_stock_flag(db: Session, product_id: uuid.UUID) -> None:
    db.execute(
        update(LowStockFlag)
        .where(LowStockFlag.product_id == product_id, LowStockFlag.cleared_at.is_(None))
        .values(cleared_at=utcnow())
    )


def flag_low_stock(
    db: Session, actor: Staff, product: Product, context: RequestContext
) -> tuple[LowStockFlag, list[Staff]]:
    """Records that someone at the counter says a product is running low. Returns the flag and who to email
    (every active manager, or the owner if there is none). Flagging twice only tells people once."""
    existing = open_low_stock_flag(db, product.id)
    if existing is not None:
        return existing, []

    flag = LowStockFlag(product_id=product.id, flagged_by_staff_id=actor.id)
    db.add(flag)
    audit.record(
        db, actor, "product.low_stock_flagged",
        entity_type="product", entity_id=product.id, entity_label=_label(product),
        after={"stock_qty": product.stock_qty, "low_stock_alert": product.low_stock_alert},
        context=context,
    )
    db.flush()

    active = select(Staff).where(Staff.is_active.is_(True)).order_by(Staff.name)
    recipients = list(db.scalars(active.where(Staff.role == Role.MANAGER)))
    if not recipients:
        recipients = list(db.scalars(active.where(Staff.role == Role.OWNER)))
    return flag, recipients
