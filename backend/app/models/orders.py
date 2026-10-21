import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.security import utcnow
from app.models.base import Base, IdMixin, TimestampMixin, one_of

# Lifecycle from HANDOFF.md: New -> Preparing -> Ready -> Collected; Cancelled from New, Preparing or Ready.
ORDER_STATUSES = ("new", "preparing", "ready", "collected", "cancelled")
ORDER_SOURCES = ("online", "walk_in")
PAYMENT_METHODS = ("momo", "airtel", "pay_at_pickup", "cash", "mobile_money")
PAYMENT_STATUSES = ("unpaid", "awaiting_verification", "paid", "rejected", "refunded")
# How the money actually arrived. "Pay at pickup" orders record Cash or Mobile Money when collected.
PAID_WITH = ("momo", "airtel", "cash", "mobile_money")
# History entries that are not status changes.
ORDER_EVENTS = ("payment_sent", "payment_verified", "payment_rejected", "whatsapp_opened", "refunded")


class Order(IdMixin, TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        one_of("status", ORDER_STATUSES),
        one_of("source", ORDER_SOURCES),
        one_of("payment_method", PAYMENT_METHODS),
        one_of("payment_status", PAYMENT_STATUSES),
        CheckConstraint(f"paid_with IS NULL OR paid_with IN ({', '.join(repr(v) for v in PAID_WITH)})", name="paid_with"),
        CheckConstraint("total_rwf >= 0", name="total_not_negative"),
        # A transaction ID can be used on only one order.
        Index("uq_orders_momo_txn_id", "momo_txn_id", unique=True, postgresql_where=text("momo_txn_id IS NOT NULL")),
    )

    number: Mapped[str] = mapped_column(
        String(16),
        unique=True,
        server_default=text("next_number('PH-', 'order_number_seq')"),
    )
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id"), index=True)
    guest_name: Mapped[str | None] = mapped_column(String(120))
    guest_phone: Mapped[str | None] = mapped_column(String(12))
    guest_email: Mapped[str | None] = mapped_column(String(254))
    source: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="new", server_default="new", index=True)
    pickup_day: Mapped[date | None] = mapped_column(Date)
    payment_method: Mapped[str] = mapped_column(String(16))
    payment_status: Mapped[str] = mapped_column(String(24))
    momo_txn_id: Mapped[str | None] = mapped_column(String(64))
    payment_verified_by_staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"))
    payment_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_with: Mapped[str | None] = mapped_column(String(16))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    total_rwf: Mapped[int] = mapped_column(Integer)
    created_by_staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"))


class OrderItem(IdMixin, TimestampMixin, Base):
    """Name and price are snapshots taken when the order is placed."""

    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("qty > 0", name="qty_positive"),
        CheckConstraint("unit_price_rwf >= 0", name="price_not_negative"),
    )

    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"))
    variant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("product_variants.id"))
    name_snapshot: Mapped[str] = mapped_column(String(200))
    variant_name_snapshot: Mapped[str | None] = mapped_column(String(80))
    unit_price_rwf: Mapped[int] = mapped_column(Integer)
    qty: Mapped[int] = mapped_column(Integer)
    picked: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))


class OrderStatusHistory(IdMixin, TimestampMixin, Base):
    """The order history on S2 and M2. A row with `event` set is not a status change (for example
    "WhatsApp opened"); its to_status is the status at that moment."""

    __tablename__ = "order_status_history"
    __table_args__ = (
        one_of("to_status", ORDER_STATUSES),
        CheckConstraint(f"event IS NULL OR event IN ({', '.join(repr(v) for v in ORDER_EVENTS)})", name="event"),
    )

    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str] = mapped_column(String(16))
    staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"))
    event: Mapped[str | None] = mapped_column(String(32))
    note: Mapped[str | None] = mapped_column(Text)
    # Set in Python so entries written in one transaction keep their order (now() is fixed per transaction).
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
