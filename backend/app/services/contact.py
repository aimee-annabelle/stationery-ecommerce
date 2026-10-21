"""Contact page messages. Staff see open ones on the dashboard and mark them handled."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.phone import normalize_phone
from app.core.security import utcnow
from app.models import ContactMessage, Staff
from app.services import audit, shop_settings
from app.services.context import RequestContext
from app.services.errors import NotFound, ServiceError


def create(db: Session, *, name: str, phone: str, message: str) -> ContactMessage:
    if len(name.strip()) < 2 or not message.strip():
        raise ServiceError("Add your name and a message.", code="required")
    try:
        phone = normalize_phone(phone)
    except ValueError as error:
        raise ServiceError(str(error), code="invalid_phone") from None
    row = ContactMessage(name=name.strip(), phone=phone, message=message.strip()[:4000])
    db.add(row)
    db.flush()
    return row


def shop_email(db: Session) -> str | None:
    """The shop's email for alerts, or None while it is still a [PLACEHOLDER]."""
    email = (shop_settings.get(db, "shop", {}).get("email") or "").strip()
    return email if email and not email.startswith("[") and "@" in email else None


def open_messages(db: Session, limit: int = 20) -> list[ContactMessage]:
    return list(db.scalars(select(ContactMessage).where(ContactMessage.handled_at.is_(None))
                           .order_by(ContactMessage.created_at.desc()).limit(limit)))


def mark_handled(db: Session, actor: Staff, message_id: uuid.UUID, context: RequestContext) -> ContactMessage:
    row = db.get(ContactMessage, message_id)
    if row is None:
        raise NotFound("That message doesn't exist.", code="message_not_found")
    if row.handled_at is None:
        row.handled_at = utcnow()
        row.handled_by_staff_id = actor.id
        db.flush()
        audit.record(db, actor, "contact.handled", entity_type="contact_message", entity_id=row.id,
                     entity_label=row.name, after={"handled": True}, context=context)
    return row
