import uuid
from datetime import date

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, TimestampMixin, one_of

PRINT_REQUEST_TYPES = ("invitations", "binding")
# Lifecycle from HANDOFF.md: New -> Quoted -> In progress -> Ready -> Collected.
# "cancelled" is allowed in the database but not shown on any screen until the owner confirms the rule.
PRINT_REQUEST_STATUSES = ("new", "quoted", "in_progress", "ready", "collected", "cancelled")


class PrintRequest(IdMixin, TimestampMixin, Base):
    __tablename__ = "print_requests"
    __table_args__ = (
        one_of("type", PRINT_REQUEST_TYPES),
        one_of("status", PRINT_REQUEST_STATUSES),
        CheckConstraint("quote_rwf IS NULL OR quote_rwf >= 0", name="quote_not_negative"),
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


class PrintRequestFile(IdMixin, TimestampMixin, Base):
    __tablename__ = "print_request_files"

    request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("print_requests.id", ondelete="CASCADE"), index=True
    )
    url: Mapped[str] = mapped_column(String(512))
    filename: Mapped[str] = mapped_column(String(255))
