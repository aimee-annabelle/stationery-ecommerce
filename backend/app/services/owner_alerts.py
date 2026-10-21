"""Owner email alerts for sensitive actions (HANDOFF.md, "Activity log and sensitive actions").

audit.record calls `maybe_queue` for every entry. An email goes out only if the action has an alert, the
owner switched that alert on in S8, the change is committed (app.services.outbox), and the owner didn't
do it themselves.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.permissions import Role
from app.models import ActivityLog, Staff
from app.services import outbox, shop_settings
from app.services.notifications import Email

SUBJECTS = {
    "order.cancelled": "Order cancelled",
    "order.refunded": "Order refunded",
    "product.price_changed": "Price changed",
    "stock.adjusted": "Stock adjusted",
    "staff.added": "Staff member added",
    "staff.role_changed": "Staff role changed",
    "staff.access_removed": "Staff access removed",
    "staff.access_restored": "Staff access restored",
    "staff.signed_in_new_device": "Sign-in on a new device",
}


def owner(db: Session) -> Staff | None:
    return db.scalar(select(Staff).where(Staff.role == Role.OWNER, Staff.is_active.is_(True)))


def recipient(db: Session) -> str | None:
    """S8 "Send alerts to", or the owner's log-in email when it's empty or still a [PLACEHOLDER]."""
    configured = (shop_settings.get(db, "owner_alerts", {}).get("email") or "").strip()
    if configured and not configured.startswith("[") and "@" in configured:
        return configured
    person = owner(db)
    return person.email if person else None


def _body(entry: ActivityLog, actor: Staff) -> str:
    before, after = entry.before or {}, entry.after or {}
    lines = [f"{actor.name} ({actor.role}) — {SUBJECTS.get(entry.action, entry.action)}: {entry.entity_label or ''}"]
    if entry.action == "product.price_changed":
        lines.append(f"Old price: {before.get('price_rwf', 0):,} RWF. New price: {after.get('price_rwf', 0):,} RWF.")
    elif entry.action == "stock.adjusted":
        lines.append(f"Change: {after.get('change')} ({after.get('reason')}). Stock now {after.get('stock_qty')}. Note: {after.get('note')}")
    elif entry.action == "order.cancelled":
        lines.append(f"Reason: {after.get('reason')}")
    elif entry.action == "order.refunded":
        lines.append(f"Refunded: {after.get('amount_rwf', 0):,} RWF")
    elif entry.action.startswith("staff."):
        if after.get("role"):
            lines.append(f"Role: {before.get('role', '—')} → {after['role']}")
        if entry.action == "staff.signed_in_new_device":
            lines.append(f"Device: {after.get('device')}. IP: {after.get('ip')}")
    lines.append("\nThe full details are in the activity log (Staff → Activity log).")
    return "\n".join(lines)


def maybe_queue(db: Session, entry: ActivityLog, actor: Staff, alert_key: str | None) -> None:
    if alert_key is None or actor.role == Role.OWNER:
        return
    switches = shop_settings.get(db, "owner_alerts", {})
    if not switches.get(alert_key, False):
        return
    to = recipient(db)
    if to:
        outbox.queue(db, Email(to, f"Pahyems: {SUBJECTS.get(entry.action, entry.action)} — {entry.entity_label or ''}".strip(" —"),
                               _body(entry, actor)))
