"""Public shop schemas. Nothing here carries cost prices or exact stock counts."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.phone import normalize_phone
from app.schemas.catalog import CategoryOut, ImageOut

Availability = Literal["in_stock", "few_left", "out_of_stock"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PublicCategoryOut(CategoryOut):
    product_count: int  # visible products only


class Spec(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    value: str = Field(min_length=1, max_length=120)


class PublicVariantOut(BaseModel):
    id: uuid.UUID
    name: str
    swatch_hex: str | None
    availability: Availability


class PublicProductCard(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    category: CategoryOut
    price_rwf: int
    availability: Availability
    image: str | None
    has_variants: bool


class PublicProductOut(PublicProductCard):
    summary: str
    description: str
    specs: list[Spec]
    images: list[ImageOut]
    variants: list[PublicVariantOut]
    related: list[PublicProductCard]


class PublicProductPage(BaseModel):
    items: list[PublicProductCard]
    total: int
    page: int
    page_size: int


class BagLineIn(Strict):
    product_id: uuid.UUID
    variant_id: uuid.UUID | None = None
    qty: int = Field(ge=1, le=99)


class BagIn(Strict):
    items: list[BagLineIn] = Field(max_length=50)


class BagLineOut(BaseModel):
    product_id: uuid.UUID
    variant_id: uuid.UUID | None
    slug: str | None
    name: str
    variant_name: str | None
    category_name: str | None
    category_slug: str | None
    tint: str | None
    image: str | None
    qty: int
    unit_price_rwf: int
    line_total_rwf: int
    problem: str | None
    problem_code: str | None


class BagOut(BaseModel):
    lines: list[BagLineOut]
    units: int
    total_rwf: int
    can_checkout: bool


class OrderIn(Strict):
    items: list[BagLineIn] = Field(min_length=1, max_length=50)
    name: str = Field(min_length=2, max_length=120)
    phone: str
    email: EmailStr | None = None
    pickup_day: date
    payment_method: Literal["momo", "airtel", "pay_at_pickup"]

    _phone = field_validator("phone")(normalize_phone)


class TrackIn(Strict):
    number: str = Field(min_length=4, max_length=16)
    phone: str = Field(max_length=32)


class PaymentIn(Strict):
    phone: str = Field(max_length=32)
    method: Literal["momo", "airtel"]
    transaction_id: str = Field(min_length=4, max_length=60)


class PaymentInstructionsOut(BaseModel):
    method: str
    label: str
    merchant_code: str
    amount_rwf: int
    reference: str


class OrderItemOut(BaseModel):
    name: str
    variant_name: str | None
    qty: int
    unit_price_rwf: int
    line_total_rwf: int


class PublicOrderOut(BaseModel):
    number: str
    status: str
    placed_at: datetime
    pickup_day: date | None
    name: str | None
    phone: str | None  # shown as 07XX XXX XXX
    email: str | None = None  # only right after placing the order
    payment_method: str
    payment_label: str
    payment_status: str
    transaction_id_sent: bool
    total_rwf: int
    items: list[OrderItemOut]
    pay: PaymentInstructionsOut | None


class PublicSettingsOut(BaseModel):
    shop: dict
    hours: dict
    payment_methods: dict
    allow_guest_checkout: bool
    pickup_hold_days: int
    default_low_stock_alert: int
    closures: list[str]
    pickup_days: list[date]
    returns_policy: str | None
