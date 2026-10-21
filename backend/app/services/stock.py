"""The only way stock_qty changes: insert a stock movement and apply it in the same transaction.
Receiving, adjusting and their activity log entries are added in stage 2."""

import uuid

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import Product, StockMovement


def record_movement(
    db: Session,
    product: Product,
    change_qty: int,
    reason: str,
    *,
    staff_id: uuid.UUID | None = None,
    order_id: uuid.UUID | None = None,
    supplier: str | None = None,
    unit_cost_rwf: int | None = None,
    note: str | None = None,
) -> StockMovement:
    movement = StockMovement(
        product_id=product.id,
        change_qty=change_qty,
        reason=reason,
        staff_id=staff_id,
        order_id=order_id,
        supplier=supplier,
        unit_cost_rwf=unit_cost_rwf,
        note=note,
    )
    db.add(movement)
    # Applied in SQL so two movements at once can't overwrite each other.
    product.stock_qty = db.execute(
        update(Product)
        .where(Product.id == product.id)
        .values(stock_qty=Product.stock_qty + change_qty)
        .returning(Product.stock_qty)
    ).scalar_one()
    db.flush()
    return movement
