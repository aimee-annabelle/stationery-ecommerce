"""S7 Staff & roles: inviting staff and accepting invites. Role and access changes live in app.services.staff."""

import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.permissions import Role
from app.core.phone import normalize_phone
from app.core.security import hash_password, hash_token, new_opaque_token, utcnow
from app.models import Staff, StaffInvite
from app.services import audit, outbox
from app.services.context import RequestContext
from app.services.customer_auth import normalize_email
from app.services.errors import Conflict, NotFound, ServiceError
from app.services.notifications import Email
from app.services.staff import _require_staff_manager

INVITE_DAYS = 7


@dataclass(frozen=True)
class Invite:
    staff: Staff
    link: str  # shown once to the owner, to copy into WhatsApp


def invite_link(token: str) -> str:
    return f"{get_settings().frontend_origin.rstrip('/')}/staff/invite?token={token}"


def _new_invite(db: Session, actor: Staff, member: Staff) -> str:
    # One live link per person: older unused links stop working.
    db.execute(update(StaffInvite).where(StaffInvite.staff_id == member.id, StaffInvite.used_at.is_(None))
               .values(used_at=utcnow()))
    token = new_opaque_token()
    db.add(StaffInvite(staff_id=member.id, invited_by_staff_id=actor.id, token_hash=hash_token(token),
                       expires_at=utcnow() + timedelta(days=INVITE_DAYS)))
    link = invite_link(token)
    outbox.queue(db, Email(
        member.email,
        "You're invited to Pahyems staff",
        f"Hello {member.name},\n\n{actor.name} added you to the Pahyems staff as {member.role}.\n"
        f"Choose your password here (the link works for {INVITE_DAYS} days):\n{link}\n",
    ))
    return link


def invite(db: Session, actor: Staff, *, name: str, phone: str, email: str, role: str, context: RequestContext) -> Invite:
    _require_staff_manager(actor)
    if role not in (Role.MANAGER, Role.WORKER):
        raise ServiceError("Staff can be a manager or a worker.", code="invalid_role")
    if len(name.strip()) < 2:
        raise ServiceError("Add a name.", code="name_required")
    try:
        phone = normalize_phone(phone)
    except ValueError as error:
        raise ServiceError(str(error), code="invalid_phone") from None
    email = normalize_email(email)
    if db.scalar(select(Staff.id).where(Staff.email == email)) is not None:
        raise Conflict("Someone on the team already uses this email.", code="email_taken")

    member = Staff(name=name.strip(), phone=phone, email=email, role=role, password_hash=None, is_active=True)
    db.add(member)
    db.flush()
    link = _new_invite(db, actor, member)
    audit.record(db, actor, "staff.added", entity_type="staff", entity_id=member.id, entity_label=member.name,
                 after={"role": role, "email": email, "phone": phone}, context=context)
    return Invite(staff=member, link=link)


def resend(db: Session, actor: Staff, member: Staff) -> Invite:
    _require_staff_manager(actor)
    if member.password_hash is not None:
        raise ServiceError(f"{member.name} has already set a password.", code="already_joined")
    return Invite(staff=member, link=_new_invite(db, actor, member))


def find_invite(db: Session, token: str) -> tuple[StaffInvite, Staff]:
    row = db.scalar(select(StaffInvite).where(StaffInvite.token_hash == hash_token(token)).with_for_update())
    gone = NotFound("This invite link has expired or was already used. Ask the owner for a new one.", code="invite_invalid")
    if row is None or row.used_at is not None or row.expires_at <= utcnow():
        raise gone
    member = db.get(Staff, row.staff_id)
    if member is None or not member.is_active or member.password_hash is not None:
        raise gone
    return row, member


def accept(db: Session, token: str, password: str) -> Staff:
    row, member = find_invite(db, token)
    member.password_hash = hash_password(password)
    row.used_at = utcnow()
    db.flush()
    return member


def get_member(db: Session, staff_id: uuid.UUID) -> Staff:
    member = db.get(Staff, staff_id)
    if member is None:
        raise NotFound("That staff member doesn't exist.", code="staff_not_found")
    return member
