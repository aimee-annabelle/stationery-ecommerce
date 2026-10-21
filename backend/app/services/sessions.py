"""Signed-in sessions shared by customers and staff: a short-lived access token plus a refresh token
kept in an httpOnly cookie. Each refresh replaces the refresh token; only its hash is stored."""

import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import AccountType, create_access_token, hash_token, new_opaque_token, utcnow
from app.models import AuthSession
from app.services.context import RequestContext
from app.services.errors import NotAuthenticated


@dataclass(frozen=True)
class IssuedTokens:
    session: AuthSession
    access_token: str
    refresh_token: str
    refresh_max_age: int  # seconds, for the cookie


def _refresh_lifetime(account_type: AccountType) -> timedelta:
    settings = get_settings()
    days = settings.customer_refresh_days if account_type == "customer" else settings.staff_refresh_days
    return timedelta(days=days)


def _issue(session: AuthSession, account_type: AccountType, account_id: uuid.UUID) -> IssuedTokens:
    refresh_token = new_opaque_token()
    session.refresh_token_hash = hash_token(refresh_token)
    session.expires_at = utcnow() + _refresh_lifetime(account_type)
    return IssuedTokens(
        session=session,
        access_token=create_access_token(account_type, account_id, session.id),
        refresh_token=refresh_token,
        refresh_max_age=int(_refresh_lifetime(account_type).total_seconds()),
    )


def start(db: Session, account_type: AccountType, account_id: uuid.UUID, context: RequestContext) -> IssuedTokens:
    session = AuthSession(
        id=uuid.uuid4(),
        account_type=account_type,
        customer_id=account_id if account_type == "customer" else None,
        staff_id=account_id if account_type == "staff" else None,
        user_agent=(context.device or "")[:512] or None,
        ip=context.ip,
        last_used_at=utcnow(),
    )
    tokens = _issue(session, account_type, account_id)
    db.add(session)
    db.flush()
    return tokens


def find_active(db: Session, refresh_token: str | None, account_type: AccountType) -> AuthSession:
    if not refresh_token:
        raise NotAuthenticated("Please log in again.")
    session = db.scalar(
        select(AuthSession).where(
            AuthSession.refresh_token_hash == hash_token(refresh_token),
            AuthSession.account_type == account_type,
        )
    )
    if session is None or session.revoked_at is not None or session.expires_at <= utcnow():
        raise NotAuthenticated("Please log in again.")
    return session


def refresh(db: Session, session: AuthSession, context: RequestContext) -> IssuedTokens:
    account_type: AccountType = session.account_type  # type: ignore[assignment]
    account_id = session.customer_id or session.staff_id
    assert account_id is not None
    session.last_used_at = utcnow()
    session.ip = context.ip
    return _issue(session, account_type, account_id)


def is_active(db: Session, session_id: uuid.UUID) -> bool:
    session = db.get(AuthSession, session_id)
    return session is not None and session.revoked_at is None and session.expires_at > utcnow()


def revoke(session: AuthSession) -> None:
    if session.revoked_at is None:
        session.revoked_at = utcnow()


def revoke_all(db: Session, account_type: AccountType, account_id: uuid.UUID, *, except_id: uuid.UUID | None = None) -> None:
    column = AuthSession.customer_id if account_type == "customer" else AuthSession.staff_id
    query = update(AuthSession).where(column == account_id, AuthSession.revoked_at.is_(None))
    if except_id is not None:
        query = query.where(AuthSession.id != except_id)
    db.execute(query.values(revoked_at=utcnow()))


def has_signed_in_from(db: Session, staff_id: uuid.UUID, device: str | None) -> bool:
    """True if this staff member has signed in before with the same user agent."""
    return (
        db.scalar(
            select(AuthSession.id)
            .where(AuthSession.staff_id == staff_id, AuthSession.user_agent == ((device or "")[:512] or None))
            .limit(1)
        )
        is not None
    )
