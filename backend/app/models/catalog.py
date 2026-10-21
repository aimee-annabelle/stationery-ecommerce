import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, IdMixin, TimestampMixin, one_of

STOCK_REASONS = ("received", "sold", "adjusted", "damaged", "returned")
# Design token names; the frontend maps each to its colour.
CATEGORY_TINTS = ("butter", "lilac", "blush", "sage")


class Category(IdMixin, TimestampMixin, Base):
    __tablename__ = "categories"
    __table_args__ = (one_of("tint", CATEGORY_TINTS),)

    name: Mapped[str] = mapped_column(String(80))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    tint: Mapped[str] = mapped_column(String(16), default="sage", server_default="sage")


class Product(IdMixin, TimestampMixin, Base):
    """stock_qty changes only through stock_movements (app.services.stock). When a product has variants,
    its stock_qty is the sum of theirs."""

    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("price_rwf >= 0", name="price_not_negative"),
        CheckConstraint("cost_rwf IS NULL OR cost_rwf >= 0", name="cost_not_negative"),
        CheckConstraint("low_stock_alert >= 0", name="low_stock_alert_not_negative"),
        CheckConstraint("stock_qty >= 0", name="stock_not_negative"),
    )

    name: Mapped[str] = mapped_column(String(160))
    slug: Mapped[str] = mapped_column(String(160), unique=True)
    category_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("categories.id"), index=True)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    price_rwf: Mapped[int] = mapped_column(Integer)
    cost_rwf: Mapped[int | None] = mapped_column(Integer)
    sku: Mapped[str] = mapped_column(String(32), unique=True)
    stock_qty: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    low_stock_alert: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    location: Mapped[str | None] = mapped_column(String(80))  # shelf
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    # Shown on the home page and first in the shop's "Featured" sort.
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # The product page "Details" tab: [{"label": "Size", "value": "A4"}, ...]
    specs: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))

    category: Mapped[Category] = relationship(lazy="joined")
    images: Mapped[list["ProductImage"]] = relationship(
        order_by="ProductImage.sort_order", cascade="all, delete-orphan", lazy="selectin"
    )
    variants: Mapped[list["ProductVariant"]] = relationship(
        order_by="(ProductVariant.sort_order, ProductVariant.name)", lazy="selectin"
    )

    @property
    def is_low(self) -> bool:
        return self.stock_qty < self.low_stock_alert

    @property
    def summary(self) -> str:
        """The short description on the product page: the first paragraph of the description."""
        return self.description.strip().split("\n\n")[0].strip()


class ProductImage(IdMixin, TimestampMixin, Base):
    """The first image (lowest sort_order) is the cover photo."""

    __tablename__ = "product_images"

    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    url: Mapped[str] = mapped_column(String(512))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))


class ProductVariant(IdMixin, TimestampMixin, Base):
    """For example a cover colour. Each variant has its own stock; the product's stock is their sum."""

    __tablename__ = "product_variants"
    __table_args__ = (
        UniqueConstraint("product_id", "name", name="uq_product_variants_product_name"),
        CheckConstraint("stock_qty >= 0", name="stock_not_negative"),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    swatch_hex: Mapped[str | None] = mapped_column(String(7))  # colour shown on the product page
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    stock_qty: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))


class StockMovement(IdMixin, TimestampMixin, Base):
    """Append-only: a database trigger rejects UPDATE and DELETE."""

    __tablename__ = "stock_movements"
    __table_args__ = (
        one_of("reason", STOCK_REASONS),
        CheckConstraint("change_qty <> 0", name="change_not_zero"),
        Index("ix_stock_movements_created_at", "created_at"),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"), index=True)
    variant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("product_variants.id"), index=True
    )
    change_qty: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(16))
    supplier: Mapped[str | None] = mapped_column(String(160))
    unit_cost_rwf: Mapped[int | None] = mapped_column(Integer)
    order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"), index=True)
    staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"))
    note: Mapped[str | None] = mapped_column(Text)


class LowStockFlag(IdMixin, TimestampMixin, Base):
    """A worker's "Tell the manager it's running low" (M4). Cleared once stock is back at or above the alert."""

    __tablename__ = "low_stock_flags"
    __table_args__ = (
        Index("uq_low_stock_flags_open", "product_id", unique=True, postgresql_where=text("cleared_at IS NULL")),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"), index=True)
    flagged_by_staff_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"))
    cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
