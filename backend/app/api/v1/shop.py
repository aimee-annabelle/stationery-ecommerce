"""Shop routes for guests: bag pricing, placing an order, tracking it, and sending a MoMo transaction ID."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, status

from app.api.deps import DB, OptionalCustomer
from app.core.phone import format_phone
from app.core.ratelimit import rate_limit
from app.models import Order
from app.schemas.shop import (
    BagIn,
    BagLineOut,
    BagOut,
    OrderIn,
    OrderItemOut,
    PaymentIn,
    PaymentInstructionsOut,
    PublicOrderOut,
    PublicSettingsOut,
    TrackIn,
)
from app.services import customer_account, orders, payments, shop_settings
from app.services.notifications import Notifier, get_notifier, order_confirmation_email, send_later

router = APIRouter(tags=["shop"])
NotifierDep = Annotated[Notifier, Depends(get_notifier)]


def _requests(body: BagIn | OrderIn) -> list[orders.LineRequest]:
    return [orders.LineRequest(i.product_id, i.variant_id, i.qty) for i in body.items]


@router.get("/settings/public", response_model=PublicSettingsOut)
def public_settings(db: DB) -> PublicSettingsOut:
    return PublicSettingsOut(**shop_settings.public(db))


@router.post("/cart/quote", response_model=BagOut)
def quote_bag(body: BagIn, db: DB) -> BagOut:
    """Prices a bag kept in the browser. Used by the bag and checkout pages; nothing is saved."""
    lines = orders.price_lines(db, _requests(body))
    out = [
        BagLineOut(
            product_id=l.request.product_id,
            variant_id=l.request.variant_id,
            slug=l.product.slug if l.product and l.product.is_visible else None,
            name=l.product.name if l.product else "Item no longer sold",
            variant_name=l.variant.name if l.variant else None,
            category_name=l.product.category.name if l.product else None,
            category_slug=l.product.category.slug if l.product else None,
            tint=l.product.category.tint if l.product else None,
            image=l.product.images[0].url if l.product and l.product.images else None,
            qty=l.qty,
            unit_price_rwf=l.unit_price_rwf,
            line_total_rwf=l.line_total_rwf,
            problem=l.problem,
            problem_code=l.problem_code,
        )
        for l in lines
    ]
    ok = [l for l in out if not l.problem]
    return BagOut(
        lines=out,
        units=sum(l.qty for l in ok),
        total_rwf=sum(l.line_total_rwf for l in ok),
        can_checkout=bool(out) and len(ok) == len(out),
    )


def _order_out(db: DB, order: Order, *, include_email: bool = False) -> PublicOrderOut:
    pay = payments.instructions(db, order)
    return PublicOrderOut(
        number=order.number,
        status=order.status,
        placed_at=order.created_at,
        pickup_day=order.pickup_day,
        name=order.guest_name,
        phone=format_phone(order.guest_phone) if order.guest_phone else None,
        email=order.guest_email if include_email else None,
        payment_method=order.payment_method,
        payment_label=payments.METHOD_LABELS.get(order.payment_method, order.payment_method),
        payment_status=order.payment_status,
        transaction_id_sent=order.momo_txn_id is not None,
        total_rwf=order.total_rwf,
        items=[
            OrderItemOut(name=i.name_snapshot, variant_name=i.variant_name_snapshot, qty=i.qty,
                         unit_price_rwf=i.unit_price_rwf, line_total_rwf=i.unit_price_rwf * i.qty)
            for i in orders.items(db, order)
        ],
        pay=PaymentInstructionsOut(**pay.__dict__) if pay else None,
    )


def _payment_steps(pay: payments.PaymentInstructions | None) -> str | None:
    if pay is None:
        return None
    return (
        f"Pay {pay.amount_rwf:,} RWF with {pay.label} to merchant code {pay.merchant_code}. "
        f"Use {pay.reference} as the reference, then send us the transaction ID from your order page."
    )


@router.post(
    "/orders",
    response_model=PublicOrderOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("place_order", 10, 10 * 60))],
)
def place_order(
    body: OrderIn, db: DB, background: BackgroundTasks, notifier: NotifierDep, customer: OptionalCustomer
) -> PublicOrderOut:
    """Guests and signed-in customers. A customer's order is linked to their account and empties their bag."""
    order, lines = orders.place_online_order(
        db,
        lines=_requests(body),
        guest_name=body.name,
        guest_phone=body.phone,
        guest_email=body.email,
        pickup_day=body.pickup_day,
        payment_method=body.payment_method,
        customer_id=customer.id if customer else None,
    )
    if customer is not None:
        customer_account.set_cart(db, customer, [])
    db.commit()
    out = _order_out(db, order, include_email=True)
    if order.guest_email:
        shop = shop_settings.get(db, "shop", {})
        send_later(background, notifier, order_confirmation_email(
            order.guest_email,
            number=order.number,
            name=order.guest_name or "",
            lines=[(f"{i.name} ({i.variant_name})" if i.variant_name else i.name, i.qty, i.line_total_rwf) for i in out.items],
            total_rwf=order.total_rwf,
            pickup_day=order.pickup_day.strftime("%A %d %B") if order.pickup_day else "",
            address=shop.get("address", ""),
            payment_steps=_payment_steps(payments.instructions(db, order)),
        ))
    return out


@router.post("/orders/track", response_model=PublicOrderOut, dependencies=[Depends(rate_limit("track", 10, 5 * 60))])
def track_order(body: TrackIn, db: DB) -> PublicOrderOut:
    return _order_out(db, orders.find_for_customer(db, body.number, body.phone))


@router.post(
    "/orders/{number}/payment",
    response_model=PublicOrderOut,
    dependencies=[Depends(rate_limit("payment", 10, 5 * 60))],
)
def send_payment(number: str, body: PaymentIn, db: DB) -> PublicOrderOut:
    """The customer's MoMo or Airtel transaction ID. Staff check it against the shop's messages (stage 4)."""
    order = orders.find_for_customer(db, number, body.phone)
    orders.submit_payment(db, order, body.method, body.transaction_id)
    db.commit()
    return _order_out(db, order)
