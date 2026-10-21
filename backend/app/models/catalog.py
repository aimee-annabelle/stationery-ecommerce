import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, TimestampMixin, one_of

STOCK_REASONS = ("received", "sold", "adjusted", "damaged", "returned")


class Category(IdMixin, TimestampMixin, Base):
    __tablename__ = "categories"

    name: Mapped[str] = mapped_column(String(80))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))


class Product(IdMixin, TimestampMixin, Base):
    """stock_qty changes only through stock_movements (app.services.stock)."""

    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("price_rwf >= 0", name="price_not_negative"),
        CheckConstraint("cost_rwf IS NULL OR cost_rwf >= 0", name="cost_not_negative"),
        CheckConstraint("low_stock_alert >= 0", name="low_stock_alert_not_negative"),
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


class ProductImage(IdMixin, TimestampMixin, Base):
    __tablename__ = "product_images"

    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    url: Mapped[str] = mapped_column(String(512))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))


class ProductVariant(IdMixin, TimestampMixin, Base):
    """Optional in v1. How variant stock relates to product stock is decided in stage 2."""

    __tablename__ = "product_variants"

    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    stock_qty: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))


class StockMovement(IdMixin, TimestampMixin, Base):
    """Append-only: a database trigger rejects UPDATE and DELETE."""

    __tablename__ = "stock_movements"
    __table_args__ = (
        one_of("reason", STOCK_REASONS),
        CheckConstraint("change_qty <> 0", name="change_not_zero"),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"), index=True)
    change_qty: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(16))
    supplier: Mapped[str | None] = mapped_column(String(160))
    unit_cost_rwf: Mapped[int | None] = mapped_column(Integer)
    order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"), index=True)
    staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"))
    note: Mapped[str | None] = mapped_column(Text)
