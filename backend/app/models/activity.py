import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.security import utcnow
from app.models.base import Base, IdMixin, TimestampMixin


class ActivityLog(IdMixin, TimestampMixin, Base):
    """Append-only: a database trigger rejects UPDATE, DELETE and TRUNCATE. Write through app.services.audit."""

    __tablename__ = "activity_log"
    __table_args__ = (
        Index("ix_activity_log_at", "at"),
        Index("ix_activity_log_sensitive_at", "at", postgresql_where=text("is_sensitive")),
    )

    staff_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"), index=True)
    action: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16), index=True)  # S6 filter: orders, products, stock, requests, staff
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    entity_label: Mapped[str | None] = mapped_column(String(120))  # for example "PH-1048" or "SKU OFF-003"
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    is_sensitive: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    device: Mapped[str | None] = mapped_column(String(512))
    ip: Mapped[str | None] = mapped_column(String(64))
    # Set in Python so entries written in one transaction keep their order (now() is fixed per transaction).
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())


class ActivityReview(IdMixin, TimestampMixin, Base):
    """The owner's "Looks fine" on M6. Kept apart so the original entry is never changed."""

    __tablename__ = "activity_reviews"

    activity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("activity_log.id"), unique=True)
    reviewed_by_staff_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"))
    # Set in Python so entries written in one transaction keep their order (now() is fixed per transaction).
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
