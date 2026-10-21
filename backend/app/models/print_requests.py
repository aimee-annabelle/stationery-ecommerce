import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.security import utcnow
from app.models.base import Base, IdMixin, TimestampMixin, one_of

PRINT_REQUEST_TYPES = ("invitations", "binding")
# Lifecycle from HANDOFF.md: New -> Quoted -> In progress -> Ready -> Collected.
# "cancelled" is allowed in the database but not shown on any screen until the owner confirms the rule.
PRINT_REQUEST_STATUSES = ("new", "quoted", "in_progress", "ready", "collected", "cancelled")
# Paid at pickup, recorded when collected.
PRINT_PAID_WITH = ("cash", "mobile_money")
PRINT_EVENTS = ("whatsapp_opened", "assigned")


class PrintRequest(IdMixin, TimestampMixin, Base):
    __tablename__ = "print_requests"
    __table_args__ = (
        one_of("type", PRINT_REQUEST_TYPES),
        one_of("status", PRINT_REQUEST_STATUSES),
        CheckConstraint("quote_rwf IS NULL OR quote_rwf >= 0", name="quote_not_negative"),
        CheckConstraint("paid_with IS NULL OR paid_with IN ('cash', 'mobile_money')", name="paid_with"),
    )

    number: Mapped[str] = mapped_column(
        String(16),
        unique=True,
        server_default=text("next_number('PR-', 'print_request_number_seq')"),
    )
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id"), index=True)
    guest_name: Mapped[str | None] = mapped_column(String(120))
    guest_phone: Mapped[str | None] = mapped_column(String(12))
    guest_email: Mapped[str | None] = mapped_column(String(254))
    type: Mapped[str] = mapped_column(String(16))
    details: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    needed_by: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default="new", server_default="new", index=True)
    quote_rwf: Mapped[int | None] = mapped_column(Integer)
    ready_on: Mapped[date | None] = mapped_column(Date)
    assigned_staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"))
    quoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_with: Mapped[str | None] = mapped_column(String(16))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"))


class PrintRequestHistory(IdMixin, TimestampMixin, Base):
    """History on S3 and M5. A row with `event` set is not a status change."""

    __tablename__ = "print_request_history"
    __table_args__ = (
        one_of("to_status", PRINT_REQUEST_STATUSES),
        CheckConstraint("event IS NULL OR event IN ('whatsapp_opened', 'assigned')", name="event"),
    )

    request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("print_requests.id", ondelete="CASCADE"), index=True
    )
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str] = mapped_column(String(16))
    staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"))
    event: Mapped[str | None] = mapped_column(String(32))
    note: Mapped[str | None] = mapped_column(Text)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())


class PrintRequestFile(IdMixin, TimestampMixin, Base):
    """Uploaded files are private: `url` holds the storage key, and only staff can download them."""

    __tablename__ = "print_request_files"

    request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("print_requests.id", ondelete="CASCADE"), index=True
    )
    url: Mapped[str] = mapped_column(String(512))
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(64), default="application/octet-stream", server_default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
