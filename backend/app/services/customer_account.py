"""C1 My account: profile, password, orders, print requests, the server-side bag, and cancelling an order."""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.security import hash_password, utcnow, verify_password
from app.models import CartItem, Customer, Order, OrderItem, OrderStatusHistory, PrintRequest, Product
from app.services import orders, sessions, stock
from app.services.errors import NotFound, ServiceError


def update_profile(db: Session, customer: Customer, changes: dict) -> Customer:
    """Name, phone and notification choices. The email can't change in v1 (it would need a new code)."""
    for key in ("name", "phone", "whatsapp_updates", "marketing_opt_in"):
        if key in changes and changes[key] is not None:
            setattr(customer, key, changes[key].strip() if isinstance(changes[key], str) else changes[key])
    db.flush()
    return customer


def change_password(db: Session, customer: Customer, current: str, new: str, keep_session_id: uuid.UUID | None) -> None:
    if not verify_password(customer.password_hash, current):
        raise ServiceError("Your current password isn't right.", code="wrong_password")
    customer.password_hash = hash_password(new)
    # Sign out other devices; this one stays signed in.
    sessions.revoke_all(db, "customer", customer.id, except_id=keep_session_id)
    db.flush()


# Orders


def my_orders(db: Session, customer: Customer) -> list[Order]:
    return list(db.scalars(select(Order).where(Order.customer_id == customer.id).order_by(Order.created_at.desc()).limit(100)))


def my_order(db: Session, customer: Customer, order_id: uuid.UUID) -> Order:
    order = db.scalar(select(Order).where(Order.id == order_id, Order.customer_id == customer.id).with_for_update())
    if order is None:
        # Same answer for someone else's order as for a missing one.
        raise NotFound("That order isn't on your account.", code="order_not_found")
    return order


def can_cancel(order: Order) -> bool:
    """Before preparation and before any money is involved. Otherwise the customer calls the shop."""
    return order.status == "new" and order.payment_status in ("unpaid", "rejected")


def cancel_my_order(db: Session, customer: Customer, order_id: uuid.UUID) -> Order:
    order = my_order(db, customer, order_id)
    if not can_cancel(order):
        raise ServiceError("This order can't be cancelled online any more. Call 0786 125 023.", code="call_to_cancel")
    for item in db.scalars(select(OrderItem).where(OrderItem.order_id == order.id)):
        product = db.get(Product, item.product_id)
        variant = next((v for v in product.variants if v.id == item.variant_id), None) if item.variant_id else None
        stock.record_movement(db, product, item.qty, "returned", variant=variant, order_id=order.id,
                              note=f"Order {order.number} cancelled by the customer")
    db.add(OrderStatusHistory(order_id=order.id, from_status=order.status, to_status="cancelled", note="Cancelled by the customer"))
    order.status = "cancelled"
    order.cancel_reason = "Cancelled by the customer"
    order.cancelled_at = utcnow()
    order.momo_txn_id = None
    db.flush()
    return order


def reorder_lines(db: Session, customer: Customer, order_id: uuid.UUID) -> list[orders.LineRequest]:
    order = db.scalar(select(Order).where(Order.id == order_id, Order.customer_id == customer.id))
    if order is None:
        raise NotFound("That order isn't on your account.", code="order_not_found")
    return [orders.LineRequest(i.product_id, i.variant_id, i.qty) for i in orders.items(db, order)]


def buy_again(db: Session, customer: Customer, limit: int = 6) -> list[tuple[OrderItem, Order]]:
    """Products from past orders, most recent first, one row per product and option."""
    rows = db.execute(
        select(OrderItem, Order).join(Order, Order.id == OrderItem.order_id)
        .where(Order.customer_id == customer.id, Order.status != "cancelled")
        .order_by(Order.created_at.desc())
    ).all()
    seen, out = set(), []
    for item, order in rows:
        key = (item.product_id, item.variant_id)
        if key not in seen:
            seen.add(key)
            out.append((item, order))
        if len(out) >= limit:
            break
    return out


def my_requests(db: Session, customer: Customer) -> list[PrintRequest]:
    return list(db.scalars(select(PrintRequest).where(PrintRequest.customer_id == customer.id)
                           .order_by(PrintRequest.created_at.desc()).limit(100)))


def my_request(db: Session, customer: Customer, request_id: uuid.UUID) -> PrintRequest:
    request = db.scalar(select(PrintRequest).where(PrintRequest.id == request_id, PrintRequest.customer_id == customer.id)
                        .with_for_update())
    if request is None:
        raise NotFound("That request isn't on your account.", code="request_not_found")
    return request


# Bag on the server


def get_cart(db: Session, customer: Customer) -> list[orders.LineRequest]:
    rows = db.scalars(select(CartItem).where(CartItem.customer_id == customer.id).order_by(CartItem.created_at))
    return [orders.LineRequest(r.product_id, r.variant_id, r.qty) for r in rows]


def set_cart(db: Session, customer: Customer, lines: list[orders.LineRequest]) -> list[orders.LineRequest]:
    """Replaces the bag. Lines for products that no longer exist are dropped."""
    merged: dict[tuple, int] = {}
    for line in lines:
        key = (line.product_id, line.variant_id)
        merged[key] = min(99, merged.get(key, 0) + line.qty)
    existing = set(db.scalars(select(Product.id).where(Product.id.in_([k[0] for k in merged]))))
    db.execute(delete(CartItem).where(CartItem.customer_id == customer.id))
    for (product_id, variant_id), qty in merged.items():
        if product_id in existing and qty > 0:
            db.add(CartItem(customer_id=customer.id, product_id=product_id, variant_id=variant_id, qty=qty))
    db.flush()
    return get_cart(db, customer)
