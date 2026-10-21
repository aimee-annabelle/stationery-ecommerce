import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, TimestampMixin


class Setting(IdMixin, TimestampMixin, Base):
    """Shop details, hours, payment methods, templates, receipt text and owner alerts. Keys are listed in app.seed."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), unique=True)
    value: Mapped[dict | list | str | int | bool | None] = mapped_column(JSONB)


class ContactMessage(IdMixin, TimestampMixin, Base):
    __tablename__ = "contact_messages"

    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(12))
    message: Mapped[str] = mapped_column(Text)
    handled_by_staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"))
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CartItem(IdMixin, TimestampMixin, Base):
    """A signed-in customer's bag, kept on the server (HANDOFF.md: "on the server for customers").
    Prices are never stored here; they come from the products when the bag is priced."""

    __tablename__ = "cart_items"
    __table_args__ = (
        # NULLS NOT DISTINCT: a product without options can only appear once.
        UniqueConstraint("customer_id", "product_id", "variant_id", name="uq_cart_items_line", postgresql_nulls_not_distinct=True),
        CheckConstraint("qty > 0 AND qty <= 99", name="qty_range"),
    )

    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"))
    variant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("product_variants.id", ondelete="CASCADE"))
    qty: Mapped[int] = mapped_column(Integer)
