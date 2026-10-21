"""Payments (HANDOFF.md, "Payments"). In v1 nothing moves money: customers pay the shop's MoMo or Airtel
merchant code and type the transaction ID, and staff check it by hand (stage 4).

Checkout code talks only to PaymentProvider, so an aggregator (Paypack, IntouchPay) or the MTN MoMo API can
replace ManualMomoProvider later without touching it.
"""

import re
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Order
from app.services import shop_settings
from app.services.errors import Conflict, ServiceError

MOBILE_MONEY = ("momo", "airtel")
METHOD_LABELS = {
    "momo": "MTN Mobile Money",
    "airtel": "Airtel Money",
    "pay_at_pickup": "Pay at pickup",
    "cash": "Cash",
    "mobile_money": "Mobile Money",
}
TXN_ID = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{3,39}$")


@dataclass(frozen=True)
class PaymentInstructions:
    method: str
    label: str
    merchant_code: str
    amount_rwf: int
    reference: str  # the order number


class PaymentProvider(Protocol):
    def instructions(self, db: Session, order: Order) -> PaymentInstructions | None:
        """What the customer must do to pay, or None if nothing is needed now."""
        ...

    def submit_reference(self, db: Session, order: Order, method: str, reference: str) -> None:
        """Records the customer's proof of payment (a transaction ID for MoMo)."""
        ...


class ManualMomoProvider:
    def instructions(self, db: Session, order: Order) -> PaymentInstructions | None:
        if order.payment_method not in MOBILE_MONEY or order.payment_status in ("paid", "refunded"):
            return None
        code = shop_settings.payment_methods(db).get(order.payment_method, {}).get("merchant_code") or "[MERCHANT CODE]"
        return PaymentInstructions(
            method=order.payment_method,
            label=METHOD_LABELS[order.payment_method],
            merchant_code=code,
            amount_rwf=order.total_rwf,
            reference=order.number,
        )

    def submit_reference(self, db: Session, order: Order, method: str, reference: str) -> None:
        if order.status == "cancelled":
            raise ServiceError("This order was cancelled.", code="order_cancelled")
        if order.payment_method not in MOBILE_MONEY:
            raise ServiceError("This order is paid at pickup.", code="not_mobile_money")
        if order.payment_status == "paid":
            raise ServiceError("This payment is already confirmed.", code="already_paid")
        if method not in MOBILE_MONEY or not shop_settings.method_enabled(db, method):
            raise ServiceError("Choose MTN Mobile Money or Airtel Money.", code="method_unavailable")

        txn_id = reference.strip().upper().replace(" ", "")
        if not TXN_ID.match(txn_id):
            raise ServiceError("Enter the transaction ID exactly as it appears in your payment SMS.", code="invalid_txn_id")
        used = db.scalar(select(Order.id).where(Order.momo_txn_id == txn_id, Order.id != order.id))
        if used is not None:
            raise Conflict("This transaction ID has already been used for another order.", code="txn_id_used")

        order.payment_method = method
        order.momo_txn_id = txn_id
        # A new ID after a rejection goes back to the staff to check.
        order.payment_status = "awaiting_verification"
        try:
            with db.begin_nested():
                db.flush()
        except IntegrityError:
            # Another order took the same ID at the same moment.
            raise Conflict("This transaction ID has already been used for another order.", code="txn_id_used") from None


_MANUAL = ManualMomoProvider()


def provider_for(method: str) -> PaymentProvider:
    return _MANUAL


def instructions(db: Session, order: Order) -> PaymentInstructions | None:
    return provider_for(order.payment_method).instructions(db, order)
