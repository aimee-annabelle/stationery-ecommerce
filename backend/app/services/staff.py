"""Staff roles and access. The S7 screen and its endpoints come in stage 6; the owner rules live here now
so every caller gets them: there is exactly one owner, who can't be demoted or locked out."""

from sqlalchemy.orm import Session

from app.core.permissions import Capability, Role, has_capability
from app.models import Staff
from app.services import audit, sessions
from app.services.context import RequestContext
from app.services.errors import Forbidden, ServiceError

OWNER_PROTECTED = "The owner's role and access can't be changed."


def _require_staff_manager(actor: Staff) -> None:
    if not has_capability(actor.role, Capability.STAFF_MANAGE):
        raise Forbidden("Only the owner can change staff roles and access.", code="forbidden")


def change_role(db: Session, actor: Staff, target: Staff, new_role: str, context: RequestContext) -> Staff:
    _require_staff_manager(actor)
    if target.role == Role.OWNER:
        raise ServiceError(OWNER_PROTECTED, code="owner_protected")
    if new_role not in (Role.MANAGER, Role.WORKER):
        raise ServiceError("Staff can be a manager or a worker.", code="invalid_role")
    if target.role == new_role:
        return target

    before = {"role": target.role}
    target.role = new_role
    audit.record(
        db, actor, "staff.role_changed",
        entity_type="staff", entity_id=target.id, entity_label=target.name,
        before=before, after={"role": new_role}, context=context,
    )
    return target


def set_active(db: Session, actor: Staff, target: Staff, active: bool, context: RequestContext) -> Staff:
    _require_staff_manager(actor)
    if target.role == Role.OWNER:
        raise ServiceError(OWNER_PROTECTED, code="owner_protected")
    if target.is_active == active:
        return target

    target.is_active = active
    if not active:
        # Signs them out everywhere straight away.
        sessions.revoke_all(db, "staff", target.id)
    audit.record(
        db, actor, "staff.access_restored" if active else "staff.access_removed",
        entity_type="staff", entity_id=target.id, entity_label=target.name,
        before={"is_active": not active}, after={"is_active": active}, context=context,
    )
    return target
