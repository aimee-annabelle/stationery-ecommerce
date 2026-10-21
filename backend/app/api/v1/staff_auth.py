"""Staff auth: POST /staff/auth/login, /refresh, /logout, and GET /staff/me.
POST /staff/auth/accept-invite is added with staff invites in stage 6."""

from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Response, status

from app.api.cookies import REFRESH_COOKIES, clear_refresh_cookie, set_refresh_cookie
from app.api.deps import DB, AnyStaff, Context
from app.core.config import get_settings
from app.core.permissions import capabilities_for
from app.core.ratelimit import rate_limit
from app.core.security import utcnow
from app.models import Staff
from app.schemas.auth import LoginIn, StaffOut, StaffTokenOut
from app.services import sessions, staff_auth
from app.services.errors import NotAuthenticated
from app.services.sessions import IssuedTokens

router = APIRouter(tags=["staff auth"])

RefreshCookie = Annotated[str | None, Cookie(alias=REFRESH_COOKIES["staff"][0])]


def staff_out(staff: Staff) -> StaffOut:
    return StaffOut(
        id=staff.id,
        name=staff.name,
        phone=staff.phone,
        email=staff.email,
        role=staff.role,
        capabilities=sorted(capabilities_for(staff.role)),
    )


def _signed_in(response: Response, staff: Staff, tokens: IssuedTokens) -> StaffTokenOut:
    set_refresh_cookie(response, "staff", tokens.refresh_token, tokens.refresh_max_age)
    return StaffTokenOut(
        access_token=tokens.access_token,
        expires_in=get_settings().access_token_minutes * 60,
        staff=staff_out(staff),
    )


@router.post(
    "/staff/auth/login",
    response_model=StaffTokenOut,
    dependencies=[Depends(rate_limit("staff_login", 10, 5 * 60))],
)
def login(body: LoginIn, db: DB, context: Context, response: Response) -> StaffTokenOut:
    staff, tokens = staff_auth.login(db, email=body.email, password=body.password, context=context)
    db.commit()
    return _signed_in(response, staff, tokens)


@router.post("/staff/auth/refresh", response_model=StaffTokenOut)
def refresh(db: DB, context: Context, response: Response, refresh_token: RefreshCookie = None) -> StaffTokenOut:
    session = sessions.find_active(db, refresh_token, "staff")
    staff = db.get(Staff, session.staff_id)
    if staff is None or not staff.is_active:
        raise NotAuthenticated("Please log in again.")
    tokens = sessions.refresh(db, session, context)
    staff.last_seen_at = utcnow()
    db.commit()
    return _signed_in(response, staff, tokens)


@router.post("/staff/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(db: DB, refresh_token: RefreshCookie = None) -> Response:
    try:
        sessions.revoke(sessions.find_active(db, refresh_token, "staff"))
        db.commit()
    except NotAuthenticated:
        pass
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_refresh_cookie(response, "staff")
    return response


@router.get("/staff/me", response_model=StaffOut)
def me(staff: AnyStaff) -> StaffOut:
    """The signed-in staff member and their capabilities. The frontend builds its menu from these."""
    return staff_out(staff)
