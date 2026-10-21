"""S1 / S2 / M1-M3: staff dashboard, orders, walk-in sales, payment checks and WhatsApp links."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select

from app.api.deps import DB, AnyStaff, Context, require
from app.core.permissions import Capability
from app.models import Order, OrderItem, OrderStatusHistory, Product, Staff
from app.schemas.staff_orders import (
    AdvanceIn,
    CancelIn,
    HistoryRow,
    OrderDetail,
    OrderItemRow,
    OrderList,
    OrderRow,
    PickIn,
    ReceiptOut,
    VerifyIn,
    WalkInIn,
    WhatsAppIn,
    WhatsAppOut,
)
from app.services import dashboard, orders, shop_settings, staff_orders

router = APIRouter(prefix="/staff", tags=["staff orders"])

Creator = Annotated[Staff, Depends(require(Capability.ORDERS_CREATE))]
Updater = Annotated[Staff, Depends(require(Capability.ORDERS_UPDATE_STATUS))]
Verifier = Annotated[Staff, Depends(require(Capability.PAYMENTS_VERIFY))]
Canceller = Annotated[Staff, Depends(require(Capability.ORDERS_CANCEL))]
# Viewing orders: every staff member handles them (orders.update_status is in every role).
Viewer = Updater


@router.get("/dashboard")
def get_dashboard(db: DB, staff: AnyStaff) -> dict:
    """The signed-in role's view. Sections a role can't use are left out, not sent empty."""
    return dashboard.build(db, staff)


def _row(db: DB, order: Order, item_count: int, verified_by: str | None = None) -> dict:
    return dict(
        id=order.id, number=order.number, source=order.source, placed_at=order.created_at,
        customer=staff_orders.customer_name(order), phone=staff_orders.customer_phone(order),
        items=item_count, total_rwf=order.total_rwf, payment=staff_orders.payment_label(order, verified_by),
        payment_method=order.payment_method, payment_status=order.payment_status, status=order.status,
        expired=staff_orders.is_expired(db, order),
    )


@router.get("/orders", response_model=OrderList)
def list_orders(
    db: DB,
    staff: Viewer,
    status_filter: Annotated[str | None, Query(alias="status", pattern="^(new|preparing|ready|collected|cancelled|expired|open)$")] = None,
    q: Annotated[str | None, Query(max_length=80)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 30,
) -> OrderList:
    rows, total = staff_orders.list_orders(db, status=status_filter, q=q, page=page, page_size=page_size)
    counts = staff_orders.item_counts(db, [o.id for o in rows])
    names = staff_orders.staff_names(db, {o.payment_verified_by_staff_id for o in rows})
    return OrderList(
        items=[OrderRow(**_row(db, o, int(counts.get(o.id, 0)), names.get(o.payment_verified_by_staff_id))) for o in rows],
        total=total, page=page, page_size=page_size, counts=staff_orders.status_counts(db),
    )


def _items(db: DB, order: Order) -> list[OrderItemRow]:
    rows = db.execute(
        select(OrderItem, Product.location).join(Product, Product.id == OrderItem.product_id)
        .where(OrderItem.order_id == order.id).order_by(OrderItem.created_at)
    ).all()
    return [
        OrderItemRow(id=i.id, name=i.name_snapshot, variant_name=i.variant_name_snapshot, qty=i.qty,
                     unit_price_rwf=i.unit_price_rwf, line_total_rwf=i.unit_price_rwf * i.qty, picked=i.picked,
                     location=location)
        for i, location in rows
    ]


def _detail(db: DB, order: Order) -> OrderDetail:
    history = db.scalars(select(OrderStatusHistory).where(OrderStatusHistory.order_id == order.id)
                         .order_by(OrderStatusHistory.at, OrderStatusHistory.created_at)).all()
    names = staff_orders.staff_names(
        db, {h.staff_id for h in history} | {order.payment_verified_by_staff_id, order.created_by_staff_id}
    )
    customer = "Customer (online)" if order.source == "online" else "Customer"
    items = _items(db, order)
    return OrderDetail(
        **_row(db, order, sum(i.qty for i in items), names.get(order.payment_verified_by_staff_id)),
        email=order.guest_email, pickup_day=order.pickup_day, paid_with=order.paid_with,
        transaction_id=order.momo_txn_id, verified_by=names.get(order.payment_verified_by_staff_id),
        verified_at=order.payment_verified_at, cancel_reason=order.cancel_reason,
        created_by=names.get(order.created_by_staff_id), line_items=items,
        history=[HistoryRow(status=h.to_status, from_status=h.from_status, event=h.event, note=h.note,
                            who=names.get(h.staff_id, customer) if h.staff_id else customer, at=h.at)
                 for h in history],
        hold_days=staff_orders.hold_days(db),
    )


@router.get("/orders/{order_id}", response_model=OrderDetail)
def get_order(order_id: uuid.UUID, db: DB, staff: Viewer) -> OrderDetail:
    return _detail(db, staff_orders.get_order(db, order_id))


@router.post("/orders", response_model=OrderDetail, status_code=status.HTTP_201_CREATED)
def create_walk_in(body: WalkInIn, db: DB, staff: Creator, context: Context) -> OrderDetail:
    order = staff_orders.create_walk_in(
        db, staff, lines=[orders.LineRequest(i.product_id, i.variant_id, i.qty) for i in body.items],
        paid_with=body.paid_with, name=body.name, phone=body.phone, context=context,
    )
    db.commit()
    return _detail(db, order)


@router.post("/orders/{order_id}/status", response_model=OrderDetail)
def advance(order_id: uuid.UUID, body: AdvanceIn, db: DB, staff: Updater, context: Context) -> OrderDetail:
    order = staff_orders.advance(db, staff, staff_orders.get_order(db, order_id, lock=True), paid_with=body.paid_with,
                                 context=context)
    db.commit()
    return _detail(db, order)


@router.patch("/orders/{order_id}/items/{item_id}", response_model=OrderDetail)
def pick_item(order_id: uuid.UUID, item_id: uuid.UUID, body: PickIn, db: DB, staff: Updater, context: Context) -> OrderDetail:
    order = staff_orders.get_order(db, order_id, lock=True)
    staff_orders.set_picked(db, staff, order, item_id, body.picked, context)
    db.commit()
    return _detail(db, order)


@router.post("/orders/{order_id}/verify-payment", response_model=OrderDetail)
def verify_payment(order_id: uuid.UUID, body: VerifyIn, db: DB, staff: Verifier, context: Context) -> OrderDetail:
    order = staff_orders.verify_payment(db, staff, staff_orders.get_order(db, order_id, lock=True), found=body.found,
                                        context=context)
    db.commit()
    return _detail(db, order)


@router.post("/orders/{order_id}/cancel", response_model=OrderDetail)
def cancel(order_id: uuid.UUID, body: CancelIn, db: DB, staff: Canceller, context: Context) -> OrderDetail:
    order = staff_orders.cancel(db, staff, staff_orders.get_order(db, order_id, lock=True), reason=body.reason,
                                refund_confirmed=body.refund_confirmed, context=context)
    db.commit()
    return _detail(db, order)


@router.post("/orders/{order_id}/whatsapp-link", response_model=WhatsAppOut)
def whatsapp_link(order_id: uuid.UUID, body: WhatsAppIn, db: DB, staff: Viewer, context: Context) -> WhatsAppOut:
    """POST rather than the spec's GET: opening WhatsApp is recorded in the order history."""
    message = staff_orders.whatsapp(db, staff, staff_orders.get_order(db, order_id), body.template, context)
    db.commit()
    return WhatsAppOut(url=message.url, text=message.text)


@router.get("/orders/{order_id}/receipt", response_model=ReceiptOut)
def receipt(order_id: uuid.UUID, db: DB, staff: Viewer) -> ReceiptOut:
    order = staff_orders.get_order(db, order_id)
    shop = shop_settings.get(db, "shop", {})
    settings = shop_settings.get(db, "receipt", {})
    names = staff_orders.staff_names(db, {order.created_by_staff_id})
    return ReceiptOut(
        number=order.number, placed_at=order.created_at,
        shop={k: shop.get(k) for k in ("name", "address", "phone")},
        show_tin=bool(settings.get("show_tin")), tin=shop.get("tin") if settings.get("show_tin") else None,
        footer=settings.get("footer", ""), returns_policy=settings.get("returns_policy"),
        customer=staff_orders.customer_name(order), served_by=names.get(order.created_by_staff_id),
        payment=staff_orders.payment_label(order), lines=_items(db, order), total_rwf=order.total_rwf,
    )
