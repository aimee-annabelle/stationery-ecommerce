import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.phone import normalize_phone
from app.schemas.shop import BagLineIn


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OrderRow(BaseModel):
    id: uuid.UUID
    number: str
    source: str
    placed_at: datetime
    customer: str
    phone: str | None
    items: int
    total_rwf: int
    payment: str  # for example "MoMo · to verify"
    payment_method: str
    payment_status: str
    status: str
    expired: bool


class OrderList(BaseModel):
    items: list[OrderRow]
    total: int
    page: int
    page_size: int
    counts: dict[str, int]  # per status, plus "expired"


class OrderItemRow(BaseModel):
    id: uuid.UUID
    name: str
    variant_name: str | None
    qty: int
    unit_price_rwf: int
    line_total_rwf: int
    picked: bool
    location: str | None  # shelf, for picking (M2)


class HistoryRow(BaseModel):
    status: str
    from_status: str | None
    event: str | None
    note: str | None
    who: str  # staff name, "Customer (online)" or "Customer"
    at: datetime


class OrderDetail(OrderRow):
    email: str | None
    pickup_day: date | None
    paid_with: str | None
    transaction_id: str | None
    verified_by: str | None
    verified_at: datetime | None
    cancel_reason: str | None
    created_by: str | None
    line_items: list[OrderItemRow]
    history: list[HistoryRow]
    hold_days: int
    prefers_call: bool  # the customer turned off WhatsApp updates in C1


class WalkInIn(Strict):
    items: list[BagLineIn] = Field(min_length=1, max_length=50)
    paid_with: Literal["cash", "mobile_money"]
    name: str | None = Field(default=None, max_length=120)
    phone: str | None = None

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str | None) -> str | None:
        return normalize_phone(value) if value and value.strip() else None


class AdvanceIn(Strict):
    # Required when collecting a pay-at-pickup order: how the customer paid at the counter.
    paid_with: Literal["cash", "mobile_money"] | None = None


class PickIn(Strict):
    picked: bool


class VerifyIn(Strict):
    found: bool


class CancelIn(Strict):
    reason: str = Field(min_length=1, max_length=500)
    refund_confirmed: bool = False


class WhatsAppIn(Strict):
    template: Literal["ready", "payment_rejected", "receipt", "general"]


class WhatsAppOut(BaseModel):
    url: str
    text: str


class ReceiptOut(BaseModel):
    number: str
    placed_at: datetime
    shop: dict
    show_tin: bool
    tin: str | None
    footer: str
    returns_policy: str | None
    customer: str
    served_by: str | None
    payment: str
    lines: list[OrderItemRow]
    total_rwf: int
