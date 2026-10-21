"""Catalog and stock schemas.

Cost fields (cost_rwf, unit_cost_rwf) are optional and left unset for staff without costs.view.
The routes use response_model_exclude_unset, so for workers the keys are missing from the JSON entirely.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.catalog import CATEGORY_TINTS

Tint = Literal[CATEGORY_TINTS]  # type: ignore[valid-type]
SWATCH = r"^#[0-9A-Fa-f]{6}$"
Money = Field(ge=0, le=100_000_000)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    tint: str
    sort_order: int


class StaffCategoryOut(CategoryOut):
    product_count: int


class CategoryIn(Strict):
    name: str = Field(min_length=2, max_length=80)
    tint: Tint | None = None


class CategoryPatch(Strict):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    tint: Tint | None = None
    sort_order: int | None = Field(default=None, ge=0, le=1000)


class SpecIn(Strict):
    label: str = Field(min_length=1, max_length=40)
    value: str = Field(min_length=1, max_length=120)


class ImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    url: str
    sort_order: int


class VariantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    swatch_hex: str | None
    stock_qty: int


class LowStockFlagOut(BaseModel):
    flagged_by: str
    flagged_at: datetime


class StaffProductOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    sku: str
    category: CategoryOut
    description: str
    price_rwf: int
    cost_rwf: int | None = None  # managers and the owner only
    stock_qty: int
    low_stock_alert: int
    is_low: bool
    location: str | None
    is_visible: bool
    is_featured: bool
    specs: list[dict]
    images: list[ImageOut]
    variants: list[VariantOut]
    low_stock_flag: LowStockFlagOut | None


class ProductPage(BaseModel):
    items: list[StaffProductOut]
    total: int
    page: int
    page_size: int


class VariantIn(Strict):
    name: str = Field(min_length=1, max_length=80)
    swatch_hex: str | None = Field(default=None, pattern=SWATCH)
    opening_stock: int = Field(default=0, ge=0, le=100_000)


class VariantPatch(Strict):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    swatch_hex: str | None = Field(default=None, pattern=SWATCH)


class ProductIn(Strict):
    name: str = Field(min_length=2, max_length=160)
    category_id: uuid.UUID
    price_rwf: int = Money
    cost_rwf: int | None = Field(default=None, ge=0, le=100_000_000)
    sku: str = Field(min_length=1, max_length=32)
    opening_stock: int = Field(default=0, ge=0, le=100_000)
    low_stock_alert: int = Field(default=0, ge=0, le=100_000)
    description: str = Field(default="", max_length=4000)
    location: str | None = Field(default=None, max_length=80)
    is_visible: bool = False
    is_featured: bool = False
    specs: list[SpecIn] = Field(default_factory=list, max_length=20)
    variants: list[VariantIn] = Field(default_factory=list, max_length=20)


class ProductPatch(Strict):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    category_id: uuid.UUID | None = None
    price_rwf: int | None = Field(default=None, ge=0, le=100_000_000)
    cost_rwf: int | None = Field(default=None, ge=0, le=100_000_000)
    sku: str | None = Field(default=None, min_length=1, max_length=32)
    low_stock_alert: int | None = Field(default=None, ge=0, le=100_000)
    description: str | None = Field(default=None, max_length=4000)
    location: str | None = Field(default=None, max_length=80)
    is_visible: bool | None = None
    is_featured: bool | None = None
    specs: list[SpecIn] | None = Field(default=None, max_length=20)


class PhotoOrderIn(Strict):
    image_ids: list[uuid.UUID]


class ReceiveIn(Strict):
    product_id: uuid.UUID
    variant_id: uuid.UUID | None = None
    qty: int = Field(gt=0, le=100_000)
    supplier: str | None = Field(default=None, max_length=160)
    unit_cost_rwf: int | None = Field(default=None, ge=0, le=100_000_000)
    note: str | None = Field(default=None, max_length=500)


class AdjustIn(Strict):
    product_id: uuid.UUID
    variant_id: uuid.UUID | None = None
    change_qty: int = Field(ge=-100_000, le=100_000)
    reason: Literal["adjusted", "damaged", "returned"]
    note: str = Field(min_length=1, max_length=500)


class MovementOut(BaseModel):
    id: uuid.UUID
    at: datetime
    product_id: uuid.UUID
    product_name: str
    sku: str
    variant_name: str | None
    change_qty: int
    reason: str
    supplier: str | None
    note: str | None
    order_number: str | None
    by: str  # staff name, "Online" for online orders, or "System"
    unit_cost_rwf: int | None = None  # managers and the owner only


class MovementPage(BaseModel):
    items: list[MovementOut]
    total: int
    page: int
    page_size: int


class LowStockFlagResult(BaseModel):
    flagged_by: str
    flagged_at: datetime
    notified: list[str]  # for example "Eric M. (Manager)"
    already_flagged: bool
