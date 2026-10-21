import uuid

from sqlalchemy import ForeignKey, String, Text
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
