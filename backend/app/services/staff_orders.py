"""Staff order handling: S2, M1, M2 and M3 (HANDOFF.md, "Order and print-request lifecycles", "Payments").

Orders move forward one stage at a time: New -> Preparing -> Ready -> Collected. Managers and the owner can
cancel from New, Preparing or Ready. Every change writes an order history row and an activity log entry in
the same transaction.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.permissions import Capability, has_capability
from app.core.phone import format_phone, normalize_phone
from app.core.security import utcnow
from app.models import Order, OrderItem, OrderStatusHistory, Product, Staff
from app.services import audit, orders, outbox, shop_settings, stock
from app.services.context import RequestContext
from app.services.errors import Forbidden, NotFound, ServiceError
from app.services.notifications import Email, fill_template, whatsapp_link
from app.services.payments import METHOD_LABELS, MOBILE_MONEY

NEXT_STATUS = {"new": "preparing", "preparing": "ready", "ready": "collected"}
OPEN_STATUSES = ("new", "preparing", "ready")
CANCELLABLE = OPEN_STATUSES
STATUS_LABELS = {"new": "New", "preparing": "Preparing", "ready": "Ready", "collected": "Collected", "cancelled": "Cancelled"}
# Message name -> key in the message_templates setting.
WHATSAPP_TEMPLATES = {"ready": "order_ready", "payment_rejected": "payment_rejected", "receipt": "receipt", "general": "general"}


def _label(order: Order) -> str:
    return order.number


def get_order(db: Session, order_id: uuid.UUID, *, lock: bool = False) -> Order:
    query = select(Order).where(Order.id == order_id)
    if lock:
        query = query.with_for_update()
    order = db.scalar(query)
    if order is None:
        raise NotFound("That order doesn't exist.", code="order_not_found")
    return order


def _history(db: Session, order: Order, actor: Staff | None, to_status: str, *, from_status: str | None = None,
             event: str | None = None, note: str | None = None) -> None:
    db.add(OrderStatusHistory(order_id=order.id, from_status=from_status, to_status=to_status,
                              staff_id=actor.id if actor else None, event=event, note=note))


# Expiry


def hold_days(db: Session) -> int:
    return int(shop_settings.get(db, "orders", {}).get("pickup_hold_days", 3))


def expired_condition(db: Session):
    """Unpaid open orders whose pickup day is more than the hold period ago. They show as "Expired" for
    staff to cancel; nothing is cancelled automatically."""
    cutoff = shop_settings.today_in_kigali() - timedelta(days=hold_days(db))
    return and_(
        Order.status.in_(OPEN_STATUSES),
        Order.payment_status.in_(("unpaid", "rejected")),
        Order.pickup_day.is_not(None),
        Order.pickup_day < cutoff,
    )


def is_expired(db: Session, order: Order) -> bool:
    if order.status not in OPEN_STATUSES or order.payment_status not in ("unpaid", "rejected") or not order.pickup_day:
        return False
    return order.pickup_day < shop_settings.today_in_kigali() - timedelta(days=hold_days(db))


# Listing


def list_orders(db: Session, *, status: str | None, q: str | None, page: int, page_size: int) -> tuple[list[Order], int]:
    query = select(Order)
    if status == "expired":
        query = query.where(expired_condition(db))
    elif status == "open":
        query = query.where(Order.status.in_(OPEN_STATUSES))
    elif status:
        query = query.where(Order.status == status)
    if q and q.strip():
        term = q.strip()
        conditions = [Order.number.ilike(f"%{term}%"), Order.guest_name.ilike(f"%{term}%")]
        try:
            conditions.append(Order.guest_phone == normalize_phone(term))
        except ValueError:
            digits = "".join(ch for ch in term if ch.isdigit())
            if len(digits) >= 4:
                conditions.append(Order.guest_phone.like(f"%{digits.lstrip('0')}%"))
        query = query.where(or_(*conditions))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    # Open orders oldest first would bury new ones; staff see the newest first, as on S2.
    rows = db.scalars(query.order_by(Order.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return list(rows), total


def status_counts(db: Session) -> dict[str, int]:
    counts = dict(db.execute(select(Order.status, func.count()).group_by(Order.status)).all())
    counts["expired"] = db.scalar(select(func.count()).select_from(Order).where(expired_condition(db))) or 0
    return counts


def item_counts(db: Session, order_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not order_ids:
        return {}
    return dict(db.execute(
        select(OrderItem.order_id, func.sum(OrderItem.qty)).where(OrderItem.order_id.in_(order_ids)).group_by(OrderItem.order_id)
    ).all())


def staff_names(db: Session, ids: set[uuid.UUID | None]) -> dict[uuid.UUID, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict(db.execute(select(Staff.id, Staff.name).where(Staff.id.in_(ids))).all())


def payment_label(order: Order, verified_by: str | None = None) -> str:
    """Short payment text for S2, M2 and receipts, for example "Paid · MoMo, verified by Diane K."."""
    method = {"momo": "MoMo", "airtel": "Airtel", "pay_at_pickup": "Pay at pickup", "cash": "Cash",
              "mobile_money": "Mobile Money"}.get(order.payment_method, order.payment_method)
    if order.source == "walk_in":
        return method
    if order.payment_status == "paid":
        if order.paid_with and order.payment_method == "pay_at_pickup":
            return f"Paid at pickup · {METHOD_LABELS.get(order.paid_with, order.paid_with)}"
        return f"Paid · {method}" + (f", verified by {verified_by}" if verified_by else "")
    if order.payment_status == "awaiting_verification":
        return f"{method} · to verify"
    if order.payment_status == "rejected":
        return f"{method} not found — ask customer on WhatsApp"
    if order.payment_status == "refunded":
        return "Refunded"
    return "Pay at pickup" if order.payment_method == "pay_at_pickup" else f"{method} · not paid yet"


# Walk-in sales (M3 and the S2 panel)


def create_walk_in(
    db: Session,
    actor: Staff,
    *,
    lines: list[orders.LineRequest],
    paid_with: str,
    name: str | None,
    phone: str | None,
    context: RequestContext,
) -> Order:
    """A sale at the counter: paid on the spot, stock goes down at once, and it starts at Collected."""
    if paid_with not in ("cash", "mobile_money"):
        raise ServiceError("Choose Cash or Mobile Money.", code="invalid_payment")
    if not lines:
        raise ServiceError("Add at least one product.", code="empty_sale")
    priced = orders.price_lines(db, lines, lock=True, allow_hidden=True)
    problems = [
        {"product_id": str(l.request.product_id), "problem": l.problem, "code": l.problem_code,
         "name": l.product.name if l.product else None}
        for l in priced if l.problem
    ]
    if problems:
        first = problems[0]
        message = f"{first['name']}: {first['problem']}" if first["name"] else first["problem"]
        raise ServiceError(message, code="sale_problem", status_code=409, details=problems)

    now = utcnow()
    order = Order(
        source="walk_in",
        status="collected",
        guest_name=(name or "").strip() or None,
        guest_phone=phone,
        payment_method=paid_with,
        payment_status="paid",
        paid_with=paid_with,
        paid_at=now,
        total_rwf=sum(l.line_total_rwf for l in priced),
        created_by_staff_id=actor.id,
        pickup_day=shop_settings.today_in_kigali(),
    )
    db.add(order)
    db.flush()
    for line in priced:
        assert line.product is not None
        db.add(OrderItem(
            order_id=order.id, product_id=line.product.id, variant_id=line.variant.id if line.variant else None,
            name_snapshot=line.product.name, variant_name_snapshot=line.variant.name if line.variant else None,
            unit_price_rwf=line.unit_price_rwf, qty=line.qty, picked=True,
        ))
        stock.record_movement(db, line.product, -line.qty, "sold", variant=line.variant, order_id=order.id, staff_id=actor.id)
    _history(db, order, actor, "collected")
    db.flush()
    audit.record(db, actor, "order.created", entity_type="order", entity_id=order.id, entity_label=_label(order),
                 after={"source": "walk_in", "total_rwf": order.total_rwf, "paid_with": paid_with,
                        "items": [{"name": l.product.name, "qty": l.qty} for l in priced if l.product]},
                 context=context)
    return order


# Status changes


def queue_receipt(db: Session, order: Order) -> None:
    """S8 "Email the receipt after payment": sent once the payment is saved, if the customer gave an email."""
    if not order.guest_email or not shop_settings.get(db, "receipt", {}).get("email_after_payment"):
        return
    footer = shop_settings.get(db, "receipt", {}).get("footer", "")
    lines = receipt_lines(orders.items(db, order))
    outbox.queue(db, Email(order.guest_email, f"Your Pahyems receipt {order.number}",
                           f"Receipt {order.number}\n\n{lines}\n\nTotal {order.total_rwf:,} RWF\nPaid: {payment_label(order)}\n\n{footer}"))


def advance(db: Session, actor: Staff, order: Order, *, paid_with: str | None, context: RequestContext) -> Order:
    """One step forward. Ready needs every item picked; Collected needs the order paid. A pay-at-pickup
    order is paid at the counter, so collecting it records Cash or Mobile Money."""
    nxt = NEXT_STATUS.get(order.status)
    if nxt is None:
        raise ServiceError(f"This order is {STATUS_LABELS[order.status].lower()}; it can't move on.", code="final_status")

    if nxt == "ready":
        unpicked = db.scalar(select(func.count()).select_from(OrderItem).where(OrderItem.order_id == order.id, OrderItem.picked.is_(False)))
        if unpicked:
            raise ServiceError("Tick every item before marking ready.", code="items_not_picked")

    before = {"status": order.status, "payment_status": order.payment_status}
    if nxt == "collected" and order.payment_status != "paid":
        if order.payment_method in MOBILE_MONEY:
            raise ServiceError("Confirm the Mobile Money payment before marking it collected.", code="not_paid")
        if paid_with not in ("cash", "mobile_money"):
            raise ServiceError("Choose how the customer paid: Cash or Mobile Money.", code="paid_with_required")
        order.payment_status = "paid"
        order.paid_with = paid_with
        order.paid_at = utcnow()
        queue_receipt(db, order)

    _history(db, order, actor, nxt, from_status=order.status)
    order.status = nxt
    db.flush()
    audit.record(db, actor, "order.status_changed", entity_type="order", entity_id=order.id, entity_label=_label(order),
                 before=before, after={"status": nxt, "payment_status": order.payment_status, "paid_with": order.paid_with},
                 context=context)
    return order


def set_picked(db: Session, actor: Staff, order: Order, item_id: uuid.UUID, picked: bool, context: RequestContext) -> OrderItem:
    if order.status not in ("new", "preparing"):
        raise ServiceError("Items can only be ticked while the order is being prepared.", code="not_preparing")
    item = db.scalar(select(OrderItem).where(OrderItem.id == item_id, OrderItem.order_id == order.id))
    if item is None:
        raise NotFound("That item isn't on this order.", code="item_not_found")
    if item.picked != picked:
        item.picked = picked
        db.flush()
        audit.record(db, actor, "order.item_picked", entity_type="order", entity_id=order.id, entity_label=_label(order),
                     after={"item": item.name_snapshot, "picked": picked}, context=context)
    return item


def verify_payment(db: Session, actor: Staff, order: Order, *, found: bool, context: RequestContext) -> Order:
    """Staff checked the transaction ID against the shop's MoMo messages. Logged as sensitive either way."""
    if order.payment_method not in MOBILE_MONEY or order.payment_status != "awaiting_verification":
        raise ServiceError("There is no Mobile Money payment waiting to be checked.", code="nothing_to_verify")
    txn_id = order.momo_txn_id
    before = {"payment_status": order.payment_status, "momo_txn_id": txn_id}
    if found:
        order.payment_status = "paid"
        order.paid_with = order.payment_method
        order.paid_at = order.payment_verified_at = utcnow()
        order.payment_verified_by_staff_id = actor.id
        queue_receipt(db, order)
    else:
        # Keeps the order. The ID is released so it doesn't block another order, and kept in the history.
        order.payment_status = "rejected"
        order.momo_txn_id = None
    _history(db, order, actor, order.status, from_status=order.status,
             event="payment_verified" if found else "payment_rejected", note=txn_id)
    db.flush()
    audit.record(db, actor, "order.payment_verified" if found else "order.payment_rejected", entity_type="order",
                 entity_id=order.id, entity_label=_label(order), before=before,
                 after={"payment_status": order.payment_status, "amount_rwf": order.total_rwf}, context=context)
    return order


def cancel(db: Session, actor: Staff, order: Order, *, reason: str, refund_confirmed: bool, context: RequestContext) -> Order:
    """Managers and the owner only. Stock goes back on the shelf. A paid order needs the manager to confirm
    the money was given back; it is then marked refunded."""
    if not has_capability(actor.role, Capability.ORDERS_CANCEL):
        raise Forbidden("Only a manager or the owner can cancel an order.", code="forbidden")
    if order.status not in CANCELLABLE:
        raise ServiceError(f"A {STATUS_LABELS[order.status].lower()} order can't be cancelled.", code="not_cancellable")
    reason = reason.strip()
    if not reason:
        raise ServiceError("Say why the order is cancelled.", code="reason_required")
    paid = order.payment_status == "paid"
    if paid and not refund_confirmed:
        raise ServiceError(f"This order is paid. Confirm you have refunded {order.total_rwf:,} RWF.", code="refund_required")

    before = {"status": order.status, "payment_status": order.payment_status}
    for item in db.scalars(select(OrderItem).where(OrderItem.order_id == order.id)):
        product = db.get(Product, item.product_id)
        variant = next((v for v in product.variants if v.id == item.variant_id), None) if item.variant_id else None
        stock.record_movement(db, product, item.qty, "returned", variant=variant, order_id=order.id, staff_id=actor.id,
                              note=f"Order {order.number} cancelled")

    _history(db, order, actor, "cancelled", from_status=order.status, note=reason)
    order.status = "cancelled"
    order.cancel_reason = reason
    order.cancelled_at = utcnow()
    if order.payment_status == "awaiting_verification":
        order.momo_txn_id = None  # not checked; release the ID
    if paid:
        order.payment_status = "refunded"
        _history(db, order, actor, "cancelled", from_status="cancelled", event="refunded", note=f"{order.total_rwf:,} RWF")
    db.flush()

    entry = {"entity_type": "order", "entity_id": order.id, "entity_label": _label(order), "context": context}
    audit.record(db, actor, "order.cancelled", before=before, after={"status": "cancelled", "reason": reason}, **entry)
    if paid:
        audit.record(db, actor, "order.refunded", after={"amount_rwf": order.total_rwf}, **entry)
    return order


# WhatsApp


@dataclass(frozen=True)
class WhatsAppMessage:
    url: str
    text: str


def receipt_lines(items: list[OrderItem]) -> str:
    return "\n".join(
        f"{i.qty} × {i.name_snapshot}{f' ({i.variant_name_snapshot})' if i.variant_name_snapshot else ''}  "
        f"{i.unit_price_rwf * i.qty:,} RWF"
        for i in items
    )


def whatsapp(db: Session, actor: Staff, order: Order, template: str, context: RequestContext) -> WhatsAppMessage:
    """Builds the click-to-chat link and records "WhatsApp opened by {staff}" in the order history."""
    if template not in WHATSAPP_TEMPLATES:
        raise ServiceError("Unknown message.", code="unknown_template")
    templates = shop_settings.get(db, "message_templates", {})
    items = orders.items(db, order)
    text = fill_template(
        templates.get(WHATSAPP_TEMPLATES[template]) or templates.get("general") or "Pahyems order {order}",
        name=order.guest_name or "",
        order=order.number,
        total=f"{order.total_rwf:,} RWF",
        items=receipt_lines(items),
        footer=shop_settings.get(db, "receipt", {}).get("footer", ""),
    )
    _history(db, order, actor, order.status, from_status=order.status, event="whatsapp_opened", note=template)
    db.flush()
    audit.record(db, actor, "order.whatsapp_opened", entity_type="order", entity_id=order.id,
                 entity_label=_label(order), after={"template": template}, context=context)
    return WhatsAppMessage(url=whatsapp_link(order.guest_phone, text), text=text)


def customer_name(order: Order) -> str:
    return order.guest_name or ("Walk-in" if order.source == "walk_in" else "—")


def customer_phone(order: Order) -> str | None:
    return format_phone(order.guest_phone) if order.guest_phone else None


def kigali_day_start(day: date) -> datetime:
    return datetime.combine(day, datetime.min.time(), tzinfo=shop_settings.KIGALI)
