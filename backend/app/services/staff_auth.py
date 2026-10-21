"""Staff log-in. Staff use a separate log-in (/staff/login) and separate tokens from customers."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import utcnow, verify_password
from app.models import Staff
from app.services import audit, sessions
from app.services.context import RequestContext
from app.services.customer_auth import normalize_email
from app.services.errors import Forbidden, NotAuthenticated
from app.services.sessions import IssuedTokens

INVALID_LOGIN = "That email and password don't match."
ACCESS_REMOVED = "Your access has been removed. Ask the owner if this is a mistake."


def login(db: Session, *, email: str, password: str, context: RequestContext) -> tuple[Staff, IssuedTokens]:
    staff = db.scalar(select(Staff).where(Staff.email == normalize_email(email)))
    if not verify_password(staff.password_hash if staff else None, password):
        raise NotAuthenticated(INVALID_LOGIN, code="invalid_credentials")
    assert staff is not None
    if not staff.is_active:
        raise Forbidden(ACCESS_REMOVED, code="access_removed")

    if not sessions.has_signed_in_from(db, staff.id, context.device):
        audit.record(
            db,
            staff,
            "staff.signed_in_new_device",
            entity_type="staff",
            entity_id=staff.id,
            entity_label=staff.name,
            after={"device": context.device, "ip": context.ip},
            context=context,
        )
    staff.last_seen_at = utcnow()
    return staff, sessions.start(db, "staff", staff.id, context)
