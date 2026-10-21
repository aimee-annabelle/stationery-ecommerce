import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, TimestampMixin, one_of

STAFF_ROLES = ("owner", "manager", "worker")
ACCOUNT_TYPES = ("customer", "staff")
CODE_PURPOSES = ("signup", "reset")


class Customer(IdMixin, TimestampMixin, Base):
    __tablename__ = "customers"

    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(12))  # 2507XXXXXXXX
    email: Mapped[str] = mapped_column(String(254), unique=True)  # stored lower-case
    password_hash: Mapped[str] = mapped_column(String(255))
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    marketing_opt_in: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))


class Staff(IdMixin, TimestampMixin, Base):
    """Staff rows are never deleted. Removing access sets is_active = false."""

    __tablename__ = "staff"
    __table_args__ = (
        one_of("role", STAFF_ROLES),
        # Exactly one owner: the database allows at most one, the staff service stops it reaching zero.
        Index("uq_staff_single_owner", "role", unique=True, postgresql_where=text("role = 'owner'")),
    )

    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(12))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))  # empty until an invite is accepted
    role: Mapped[str] = mapped_column(String(16))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class VerificationCode(IdMixin, TimestampMixin, Base):
    """6-digit email codes for customer sign-up and password reset. Only a keyed hash is stored."""

    __tablename__ = "verification_codes"
    __table_args__ = (
        one_of("purpose", CODE_PURPOSES),
        Index("ix_verification_codes_lookup", "email", "purpose"),
    )

    email: Mapped[str] = mapped_column(String(254))
    purpose: Mapped[str] = mapped_column(String(16))
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))


class AuthSession(IdMixin, TimestampMixin, Base):
    """One signed-in device. Holds the hash of its refresh token so it can be revoked."""

    __tablename__ = "auth_sessions"
    __table_args__ = (
        one_of("account_type", ACCOUNT_TYPES),
        CheckConstraint(
            "(account_type = 'customer' AND customer_id IS NOT NULL AND staff_id IS NULL)"
            " OR (account_type = 'staff' AND staff_id IS NOT NULL AND customer_id IS NULL)",
            name="one_owner",
        ),
    )

    account_type: Mapped[str] = mapped_column(String(16))
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id"), index=True
    )
    staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"), index=True)
    refresh_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_agent: Mapped[str | None] = mapped_column(String(512))
    ip: Mapped[str | None] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class StaffInvite(IdMixin, TimestampMixin, Base):
    """Set-password link sent when the owner adds staff (flow built in stage 6)."""

    __tablename__ = "staff_invites"

    staff_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"), index=True)
    invited_by_staff_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("staff.id"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
