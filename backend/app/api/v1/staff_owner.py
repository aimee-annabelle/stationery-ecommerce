"""Owner tools: S5 reports, S6 activity log, S7 staff & roles, S8 shop settings. Each route declares the
capability it needs; all of them are owner-only in the permission table."""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import DB, Context, require
from app.core.permissions import Capability, Role, capabilities_for
from app.core.phone import format_phone
from app.models import Staff
from app.services import activity, owner_alerts, reports, settings_admin, shop_settings, team
from app.services import staff as staff_service

router = APIRouter(prefix="/staff", tags=["owner tools"])
Reporter = Annotated[Staff, Depends(require(Capability.REPORTS_VIEW))]
Auditor = Annotated[Staff, Depends(require(Capability.ACTIVITY_VIEW))]
TeamManager = Annotated[Staff, Depends(require(Capability.STAFF_MANAGE))]
SettingsManager = Annotated[Staff, Depends(require(Capability.SETTINGS_MANAGE))]
Range = Annotated[Literal["7d", "30d", "year"], Query()]


# S5 Reports


@router.get("/reports")
def get_report(db: DB, owner: Reporter, range: Range = "7d") -> dict:
    return reports.build(db, range).__dict__


@router.get("/reports/export")
def export_report(db: DB, owner: Reporter, range: Range = "7d", format: Annotated[Literal["xlsx", "pdf"], Query()] = "xlsx") -> Response:
    report = reports.build(db, range)
    name = f"pahyems-report-{range}-{report.end.isoformat()}"
    if format == "xlsx":
        return Response(reports.to_xlsx(report), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'})
    shop = shop_settings.get(db, "shop", {}).get("name") or "Pahyems"
    return Response(reports.to_pdf(report, shop), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})


# S6 Activity log


def _filters(staff_id: uuid.UUID | None, kind: str | None, sensitive: bool, day: date | None) -> dict:
    return {"staff_id": staff_id, "kind": kind or None, "sensitive": sensitive, "day": day}


Kind = Annotated[str | None, Query(pattern="^(orders|products|stock|requests|staff|settings)$")]


@router.get("/activity")
def list_activity(db: DB, owner: Auditor, staff_id: uuid.UUID | None = None, kind: Kind = None, sensitive: bool = False,
                  day: date | None = None, page: Annotated[int, Query(ge=1)] = 1) -> dict:
    items, total = activity.entries(db, page=page, **_filters(staff_id, kind, sensitive, day))
    people = [{"id": s.id, "name": s.name, "role": s.role} for s in db.query(Staff).order_by(Staff.name)]
    return {"items": items, "total": total, "page": page, "page_size": 100, "staff": people}


@router.get("/activity/export")
def export_activity(db: DB, owner: Auditor, staff_id: uuid.UUID | None = None, kind: Kind = None, sensitive: bool = False,
                    day: date | None = None) -> Response:
    body = activity.to_csv(db, **_filters(staff_id, kind, sensitive, day))
    return Response("﻿" + body, media_type="text/csv; charset=utf-8",  # BOM so Excel reads the accents
                    headers={"Content-Disposition": f'attachment; filename="pahyems-activity-{date.today().isoformat()}.csv"'})


@router.post("/activity/{activity_id}/reviewed", status_code=status.HTTP_204_NO_CONTENT)
def mark_reviewed(activity_id: uuid.UUID, db: DB, owner: Auditor) -> Response:
    """M6 "Looks fine". Records the review; the log entry itself never changes."""
    activity.review(db, owner, activity_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# S7 Staff & roles


class MemberOut(BaseModel):
    id: uuid.UUID
    name: str
    phone: str
    email: str
    role: str
    is_active: bool
    invite_pending: bool
    last_seen_at: datetime | None


class TeamOut(BaseModel):
    members: list[MemberOut]
    permissions: dict[str, list[str]]  # role -> capabilities, from the code table


class InviteIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str = Field(max_length=32)
    email: EmailStr
    role: Literal["manager", "worker"]


class InviteOut(BaseModel):
    member: MemberOut
    link: str


class MemberPatch(BaseModel):
    role: Literal["manager", "worker"] | None = None
    is_active: bool | None = None


def _member(m: Staff) -> MemberOut:
    return MemberOut(id=m.id, name=m.name, phone=format_phone(m.phone), email=m.email, role=m.role, is_active=m.is_active,
                     invite_pending=m.password_hash is None, last_seen_at=m.last_seen_at)


@router.get("/team", response_model=TeamOut)
def list_team(db: DB, owner: TeamManager) -> TeamOut:
    people = db.query(Staff).order_by((Staff.role != "owner"), Staff.name).all()
    return TeamOut(members=[_member(m) for m in people],
                   permissions={r.value: sorted(capabilities_for(r)) for r in Role})


@router.post("/team/invite", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
def invite(body: InviteIn, db: DB, owner: TeamManager, context: Context) -> InviteOut:
    result = team.invite(db, owner, name=body.name, phone=body.phone, email=body.email, role=body.role, context=context)
    db.commit()
    return InviteOut(member=_member(result.staff), link=result.link)


@router.post("/team/{staff_id}/invite", response_model=InviteOut)
def resend_invite(staff_id: uuid.UUID, db: DB, owner: TeamManager) -> InviteOut:
    result = team.resend(db, owner, team.get_member(db, staff_id))
    db.commit()
    return InviteOut(member=_member(result.staff), link=result.link)


@router.patch("/team/{staff_id}", response_model=MemberOut)
def update_member(staff_id: uuid.UUID, body: MemberPatch, db: DB, owner: TeamManager, context: Context) -> MemberOut:
    member = team.get_member(db, staff_id)
    if body.role is not None:
        staff_service.change_role(db, owner, member, body.role, context)
    if body.is_active is not None:
        staff_service.set_active(db, owner, member, body.is_active, context)
    db.commit()
    return _member(member)


# S8 Shop settings


@router.get("/settings")
def get_settings(db: DB, owner: SettingsManager) -> dict:
    return {"settings": settings_admin.read_all(db), "owner_email": (owner_alerts.owner(db) or owner).email}


@router.patch("/settings")
def update_settings(body: dict, db: DB, owner: SettingsManager, context: Context) -> dict:
    """Send whole sections, for example {"orders": {...}}. Each is checked and the change is logged."""
    values = settings_admin.update(db, owner, body, context)
    db.commit()
    return {"settings": values, "owner_email": owner.email}
