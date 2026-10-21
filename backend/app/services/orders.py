"""Bag pricing and online orders. Prices and stock are always recalculated here; totals from the browser
are never used (HANDOFF.md, "Security")."""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.phone import normalize_phone
from app.models import Order, OrderItem, OrderStatusHistory, Product, ProductVariant
from app.services import payments, shop_settings, stock
from app.services.errors import NotFound, ServiceError

MAX_LINE_QTY = 99


@dataclass(frozen=True)
class LineRequest:
    product_id: uuid.UUID
    variant_id: uuid.UUID | None
    qty: int


@dataclass
class PricedLine:
    request: LineRequest
    product: Product | None
    variant: ProductVariant | None
    qty: int
    problem: str | None = None
    problem_code: str | None = None

    @property
    def unit_price_rwf(self) -> int:
        return self.product.price_rwf if self.product else 0

    @property
    def line_total_rwf(self) -> int:
        return self.unit_price_rwf * self.qty


def _merge(requests: list[LineRequest]) -> list[LineRequest]:
    """The same product and option twice becomes one line."""
    totals: dict[tuple, int] = {}
    for r in requests:
        key = (r.product_id, r.variant_id)
        totals[key] = totals.get(key, 0) + r.qty
    return [LineRequest(p, v, min(q, MAX_LINE_QTY)) for (p, v), q in totals.items()]


def price_lines(
    db: Session, requests: list[LineRequest], *, lock: bool = False, allow_hidden: bool = False
) -> list[PricedLine]:
    """Prices each line and notes anything that stops it being ordered. With lock=True the products are
    locked until the transaction ends, so stock can't change between this check and the order.
    allow_hidden is for walk-in sales: a product hidden from the online shop can still be sold at the counter."""
    requests = _merge(requests)
    ids = sorted({r.product_id for r in requests})
    query = select(Product).where(Product.id.in_(ids)).order_by(Product.id)  # fixed order avoids deadlocks
    if lock:
        query = query.with_for_update(of=Product)
    products = {p.id: p for p in db.scalars(query).unique()}
    if lock:
        for p in products.values():
            db.refresh(p)  # read stock after taking the lock

    lines = []
    for r in requests:
        product = products.get(r.product_id)
        line = PricedLine(request=r, product=product, variant=None, qty=r.qty)
        if product is None or not (product.is_visible or allow_hidden):
            line.problem, line.problem_code = "This item is no longer sold.", "unavailable"
        elif product.variants:
            line.variant = next((v for v in product.variants if v.id == r.variant_id), None)
            if line.variant is None:
                line.problem, line.problem_code = "Choose an option for this item.", "variant_required"
        elif r.variant_id is not None:
            line.problem, line.problem_code = "This option is no longer sold.", "unavailable"

        if line.problem is None:
            available = line.variant.stock_qty if line.variant else product.stock_qty
            if available <= 0:
                line.problem, line.problem_code = "Out of stock.", "out_of_stock"
            elif r.qty > available:
                line.problem, line.problem_code = f"Only {available} left.", "not_enough_stock"
        lines.append(line)
    return lines


def _check_pickup_day(db: Session, pickup_day: date) -> None:
    if pickup_day not in shop_settings.pickup_days(db):
        raise ServiceError("Choose a pickup day when the shop is open, within the next two weeks.", code="invalid_pickup_day")


def place_online_order(
    db: Session,
    *,
    lines: list[LineRequest],
    guest_name: str,
    guest_phone: str,
    guest_email: str | None,
    pickup_day: date,
    payment_method: str,
) -> tuple[Order, list[PricedLine]]:
    """A guest order from the shop. Stock is reserved straight away as "sold" movements; cancelling an
    order puts it back (stage 4)."""
    if not shop_settings.get(db, "orders", {}).get("allow_guest_checkout", True):
        raise ServiceError("Log in to place an order.", code="guest_checkout_off")
    if payment_method not in ("momo", "airtel", "pay_at_pickup") or not shop_settings.method_enabled(db, payment_method):
        raise ServiceError("Choose how you will pay.", code="method_unavailable")
    if not lines:
        raise ServiceError("Your bag is empty.", code="empty_bag")
    _check_pickup_day(db, pickup_day)

    priced = price_lines(db, lines, lock=True)
    problems = [
        {"product_id": str(l.request.product_id), "variant_id": str(l.request.variant_id) if l.request.variant_id else None,
         "problem": l.problem, "code": l.problem_code}
        for l in priced if l.problem
    ]
    if problems:
        raise ServiceError("Some items in your bag changed. Check your bag and try again.", code="bag_changed",
                           status_code=409, details=problems)

    order = Order(
        source="online",
        status="new",
        guest_name=guest_name.strip(),
        guest_phone=guest_phone,
        guest_email=(guest_email or "").strip().lower() or None,
        pickup_day=pickup_day,
        payment_method=payment_method,
        payment_status="unpaid",
        total_rwf=sum(l.line_total_rwf for l in priced),
    )
    db.add(order)
    db.flush()
    for line in priced:
        assert line.product is not None
        db.add(OrderItem(
            order_id=order.id,
            product_id=line.product.id,
            variant_id=line.variant.id if line.variant else None,
            name_snapshot=line.product.name,
            variant_name_snapshot=line.variant.name if line.variant else None,
            unit_price_rwf=line.unit_price_rwf,
            qty=line.qty,
        ))
        stock.record_movement(db, line.product, -line.qty, "sold", variant=line.variant, order_id=order.id)
    db.add(OrderStatusHistory(order_id=order.id, from_status=None, to_status="new"))
    db.flush()
    return order, priced


def find_for_customer(db: Session, number: str, phone: str) -> Order:
    """An order looked up by its number and the phone it was placed with. Wrong number and wrong phone
    get the same answer, so the lookup can't be used to find out which numbers exist."""
    not_found = NotFound("We couldn't find an order with that number and phone.", code="order_not_found")
    try:
        phone = normalize_phone(phone)
    except ValueError:
        raise not_found from None
    order = db.scalar(select(Order).where(Order.number == number.strip().upper()))
    if order is None or order.guest_phone != phone:
        raise not_found
    return order


def items(db: Session, order: Order) -> list[OrderItem]:
    return list(db.scalars(select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.created_at)))


def submit_payment(db: Session, order: Order, method: str, transaction_id: str) -> None:
    payments.provider_for(method).submit_reference(db, order, method, transaction_id)
    db.add(OrderStatusHistory(order_id=order.id, from_status=order.status, to_status=order.status,
                              event="payment_sent", note=order.momo_txn_id))
    db.flush()
