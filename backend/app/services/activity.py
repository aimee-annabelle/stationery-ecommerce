"""S6 Activity log (owner only): filters, CSV export, and the owner's "Looks fine" review (M6).
The log itself is never changed: a review is its own row in activity_reviews."""

import csv
import io
import uuid
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.models import ActivityLog, ActivityReview, Staff
from app.services import shop_settings
from app.services.activity_text import KIND_LABELS, describe
from app.services.errors import NotFound
from app.services.staff_orders import kigali_day_start


def query(*, staff_id: uuid.UUID | None = None, kind: str | None = None, sensitive: bool = False, day: date | None = None,
          unreviewed: bool = False):
    q = (select(ActivityLog, Staff.name, Staff.role, ActivityReview.at)
         .join(Staff, Staff.id == ActivityLog.staff_id)
         .outerjoin(ActivityReview, ActivityReview.activity_id == ActivityLog.id))
    if staff_id:
        q = q.where(ActivityLog.staff_id == staff_id)
    if kind:
        q = q.where(ActivityLog.kind == kind)
    if sensitive:
        q = q.where(ActivityLog.is_sensitive.is_(True))
    if day:
        q = q.where(ActivityLog.at >= kigali_day_start(day), ActivityLog.at < kigali_day_start(day + timedelta(days=1)))
    if unreviewed:
        q = q.where(ActivityReview.id.is_(None))
    return q


def entries(db: Session, page: int = 1, page_size: int = 100, **filters) -> tuple[list[dict], int]:
    q = query(**filters)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.execute(q.order_by(ActivityLog.at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return [as_dict(*r) for r in rows], total


def as_dict(entry: ActivityLog, name: str, role: str, reviewed_at) -> dict:
    return {
        "id": entry.id, "at": entry.at, "who": name, "role": role, "action": entry.action, "kind": entry.kind,
        "kind_label": KIND_LABELS.get(entry.kind, entry.kind),
        "what": describe(entry.action, entry.entity_label, entry.before, entry.after),
        "record": entry.entity_label, "before": entry.before, "after": entry.after,
        "is_sensitive": entry.is_sensitive, "device": entry.device, "ip": entry.ip, "reviewed_at": reviewed_at,
    }


def needs_eye(db: Session) -> list[dict]:
    """M6: today's sensitive actions the owner hasn't marked "Looks fine"."""
    rows = db.execute(query(sensitive=True, day=shop_settings.today_in_kigali(), unreviewed=True)
                      .where(Staff.role != "owner").order_by(ActivityLog.at.desc()).limit(30)).all()
    return [as_dict(*r) for r in rows]


def review(db: Session, owner: Staff, activity_id: uuid.UUID) -> None:
    if db.get(ActivityLog, activity_id) is None:
        raise NotFound("That entry doesn't exist.", code="activity_not_found")
    exists = db.scalar(select(ActivityReview.id).where(ActivityReview.activity_id == activity_id))
    if exists is None:
        db.add(ActivityReview(activity_id=activity_id, reviewed_by_staff_id=owner.id, at=utcnow()))
        db.flush()


def to_csv(db: Session, **filters) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["When (Kigali)", "Staff", "Role", "Action", "Type", "Sensitive", "Record", "Before", "After", "Device", "IP"])
    for row in db.execute(query(**filters).order_by(ActivityLog.at.desc()).limit(10_000)).all():
        d = as_dict(*row)
        when = d["at"].astimezone(shop_settings.KIGALI).strftime("%Y-%m-%d %H:%M")
        writer.writerow([when, d["who"], d["role"], d["what"], d["kind_label"], "yes" if d["is_sensitive"] else "",
                         d["record"] or "", d["before"] or "", d["after"] or "", d["device"] or "", d["ip"] or ""])
    return out.getvalue()
