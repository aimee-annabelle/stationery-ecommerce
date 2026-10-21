"""C1 My account for signed-in customers, the server-side bag, and resending the sign-up code.

Every route here uses CurrentCustomer, and every lookup is filtered by the customer's id, so a customer
only ever sees their own orders and requests."""

import uuid
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, status
from pydantic import BaseModel
from app.api.deps import DB, CurrentCustomer, SessionId
from app.api.v1.shop import _order_out, quote_bag
from app.core.ratelimit import rate_limit
from app.models import Customer, Product
from app.schemas.auth import CustomerOut, MessageOut, PasswordIn, ProfilePatch, ResendIn
from app.schemas.shop import BagIn, BagLineIn, BagOut, PublicOrderOut
from app.services import customer_account, customer_auth, orders, print_requests
from app.services.notifications import Notifier, get_notifier, send_later, signup_code_email

router = APIRouter(tags=["customer account"])
NotifierDep = Annotated[Notifier, Depends(get_notifier)]


class MyOrderRow(BaseModel):
    id: uuid.UUID
    number: str
    placed_at: datetime
    status: str
    items: str  # "A4 spiral notebook × 2, USB-C charger"
    item_count: int
    total_rwf: int
    payment_label: str
    payment_status: str
    can_cancel: bool


class MyRequestRow(BaseModel):
    id: uuid.UUID
    number: str
    type: str
    summary: str
    status: str
    needed_by: date | None
    quote_rwf: int | None
    ready_on: date | None


class BuyAgainRow(BaseModel):
    product_id: uuid.UUID
    variant_id: uuid.UUID | None
    slug: str | None
    name: str
    tint: str | None
    category_slug: str | None
    image: str | None
    last_bought: datetime
    available: bool


class Overview(BaseModel):
    current_order: PublicOrderOut | None
    current_order_id: uuid.UUID | None
    open_quote: MyRequestRow | None
    buy_again: list[BuyAgainRow]


def _order_row(db: DB, order) -> MyOrderRow:
    items = orders.items(db, order)
    names = ", ".join(f"{i.name_snapshot} × {i.qty}" if i.qty > 1 else i.name_snapshot for i in items)
    out = _order_out(db, order)
    return MyOrderRow(
        id=order.id, number=order.number, placed_at=order.created_at, status=order.status, items=names,
        item_count=sum(i.qty for i in items), total_rwf=order.total_rwf, payment_label=out.payment_label,
        payment_status=order.payment_status, can_cancel=customer_account.can_cancel(order),
    )


def _request_row(request) -> MyRequestRow:
    return MyRequestRow(id=request.id, number=request.number, type=request.type, summary=print_requests.summary(request),
                        status=request.status, needed_by=request.needed_by, quote_rwf=request.quote_rwf,
                        ready_on=request.ready_on)


@router.post("/auth/verify/resend", response_model=MessageOut, status_code=status.HTTP_202_ACCEPTED,
             dependencies=[Depends(rate_limit("resend", 5, 15 * 60))])
def resend_code(body: ResendIn, db: DB, background: BackgroundTasks, notifier: NotifierDep) -> MessageOut:
    """Sends a new sign-up code to an account that isn't verified yet. Same answer either way."""
    code = customer_auth.resend_signup_code(db, email=body.email)
    db.commit()
    if code is not None:
        send_later(background, notifier, signup_code_email(customer_auth.normalize_email(body.email), code))
    return MessageOut(message="If that email is waiting for a code, we sent a new one.")


@router.patch("/me", response_model=CustomerOut)
def update_me(body: ProfilePatch, db: DB, customer: CurrentCustomer) -> CustomerOut:
    customer_account.update_profile(db, customer, body.model_dump(exclude_unset=True))
    db.commit()
    return CustomerOut.model_validate(customer)


@router.post("/me/password", response_model=MessageOut)
def change_password(body: PasswordIn, db: DB, customer: CurrentCustomer, session_id: SessionId) -> MessageOut:
    customer_account.change_password(db, customer, body.current_password, body.new_password, session_id)
    db.commit()
    return MessageOut(message="Password updated. Other devices have been signed out.")


@router.get("/me/overview", response_model=Overview)
def overview(db: DB, customer: CurrentCustomer) -> Overview:
    mine = customer_account.my_orders(db, customer)
    current = next((o for o in mine if o.status in ("new", "preparing", "ready")), None)
    requests = customer_account.my_requests(db, customer)
    quote = next((r for r in requests if r.status == "quoted"), None) or next(
        (r for r in requests if r.status in ("new", "in_progress", "ready")), None
    )
    again = []
    for item, order in customer_account.buy_again(db, customer):
        product = db.get(Product, item.product_id)
        visible = product is not None and product.is_visible
        again.append(BuyAgainRow(
            product_id=item.product_id, variant_id=item.variant_id,
            slug=product.slug if visible else None,
            name=item.name_snapshot + (f" ({item.variant_name_snapshot})" if item.variant_name_snapshot else ""),
            tint=product.category.tint if product else None, category_slug=product.category.slug if product else None,
            image=product.images[0].url if product and product.images else None,
            last_bought=order.created_at, available=visible and product.stock_qty > 0,
        ))
    return Overview(
        current_order=_order_out(db, current) if current else None,
        current_order_id=current.id if current else None,
        open_quote=_request_row(quote) if quote else None,
        buy_again=again,
    )


@router.get("/me/orders", response_model=list[MyOrderRow])
def my_orders(db: DB, customer: CurrentCustomer) -> list[MyOrderRow]:
    return [_order_row(db, o) for o in customer_account.my_orders(db, customer)]


@router.get("/me/orders/{order_id}", response_model=PublicOrderOut)
def my_order(order_id: uuid.UUID, db: DB, customer: CurrentCustomer) -> PublicOrderOut:
    return _order_out(db, customer_account.my_order(db, customer, order_id))


@router.post("/me/orders/{order_id}/cancel", response_model=MyOrderRow)
def cancel_my_order(order_id: uuid.UUID, db: DB, customer: CurrentCustomer) -> MyOrderRow:
    order = customer_account.cancel_my_order(db, customer, order_id)
    db.commit()
    return _order_row(db, order)


@router.post("/me/orders/{order_id}/reorder", response_model=BagOut)
def reorder(order_id: uuid.UUID, db: DB, customer: CurrentCustomer) -> BagOut:
    """Adds the order's items to the bag at today's prices and returns the priced bag."""
    current = customer_account.get_cart(db, customer)
    customer_account.set_cart(db, customer, current + customer_account.reorder_lines(db, customer, order_id))
    db.commit()
    return _cart_out(db, customer)


@router.get("/me/print-requests", response_model=list[MyRequestRow])
def my_requests(db: DB, customer: CurrentCustomer) -> list[MyRequestRow]:
    return [_request_row(r) for r in customer_account.my_requests(db, customer)]


@router.post("/me/print-requests/{request_id}/accept-quote", response_model=MyRequestRow)
def accept_quote(request_id: uuid.UUID, db: DB, customer: CurrentCustomer) -> MyRequestRow:
    request = print_requests.accept_by_customer(db, customer_account.my_request(db, customer, request_id))
    db.commit()
    return _request_row(request)


def _cart_out(db: DB, customer: Customer) -> BagOut:
    lines = customer_account.get_cart(db, customer)
    return quote_bag(BagIn(items=[BagLineIn(product_id=l.product_id, variant_id=l.variant_id, qty=l.qty) for l in lines]), db)


@router.get("/cart", response_model=BagOut)
def get_cart(db: DB, customer: CurrentCustomer) -> BagOut:
    return _cart_out(db, customer)


@router.put("/cart", response_model=BagOut)
def put_cart(body: BagIn, db: DB, customer: CurrentCustomer) -> BagOut:
    """Replaces the bag. The browser merges its guest bag into this when the customer logs in."""
    customer_account.set_cart(db, customer, [orders.LineRequest(i.product_id, i.variant_id, i.qty) for i in body.items])
    db.commit()
    return _cart_out(db, customer)
