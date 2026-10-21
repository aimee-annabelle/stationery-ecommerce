"""Customer sign-up, email verification, log-in and password reset."""

from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import (
    codes_match,
    hash_code,
    hash_password,
    new_verification_code,
    utcnow,
    verify_password,
)
from app.models import Customer, VerificationCode
from app.services import sessions
from app.services.context import RequestContext
from app.services.errors import Conflict, Forbidden, NotAuthenticated, ServiceError
from app.services.sessions import IssuedTokens

INVALID_LOGIN = "That email and password don't match. Try again or reset your password."


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _issue_code(db: Session, email: str, purpose: str) -> str:
    """Creates a new code and cancels any earlier unused code for the same email and purpose."""
    now = utcnow()
    db.execute(
        update(VerificationCode)
        .where(VerificationCode.email == email, VerificationCode.purpose == purpose, VerificationCode.used_at.is_(None))
        .values(used_at=now)
    )
    code = new_verification_code()
    db.add(
        VerificationCode(
            email=email,
            purpose=purpose,
            code_hash=hash_code(email, purpose, code),
            expires_at=now + timedelta(minutes=get_settings().verification_code_minutes),
        )
    )
    db.flush()
    return code


def _use_code(db: Session, email: str, purpose: str, code: str) -> None:
    """Marks the code used, or raises. Wrong guesses count, and a code dies after too many."""
    settings = get_settings()
    now = utcnow()
    row = db.scalar(
        select(VerificationCode)
        .where(VerificationCode.email == email, VerificationCode.purpose == purpose, VerificationCode.used_at.is_(None))
        .order_by(VerificationCode.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    if row is None or row.expires_at <= now:
        raise ServiceError("That code has expired. Ask for a new one.", code="code_expired")
    if not codes_match(row.code_hash, hash_code(email, purpose, code.strip())):
        row.attempts += 1
        if row.attempts >= settings.verification_code_max_attempts:
            row.used_at = now
            # Commit the burnt code even though the request fails.
            db.commit()
            raise ServiceError("Too many wrong tries. Ask for a new code.", code="code_locked")
        db.commit()
        raise ServiceError("That code isn't right. Check the email and try again.", code="code_invalid")
    row.used_at = now


def signup(
    db: Session, *, name: str, phone: str, email: str, password: str, marketing_opt_in: bool
) -> tuple[Customer, str]:
    """Creates an unverified account and returns it with the code to email. Signing up again before
    verifying replaces the details and sends a fresh code."""
    email = normalize_email(email)
    customer = db.scalar(select(Customer).where(Customer.email == email))
    if customer is not None and customer.email_verified_at is not None:
        raise Conflict("An account with this email already exists. Log in or reset your password.", code="email_taken")
    if customer is None:
        customer = Customer(email=email)
        db.add(customer)
    customer.name = name.strip()
    customer.phone = phone
    customer.password_hash = hash_password(password)
    customer.marketing_opt_in = marketing_opt_in
    db.flush()
    return customer, _issue_code(db, email, "signup")


def verify_signup(db: Session, *, email: str, code: str, context: RequestContext) -> tuple[Customer, IssuedTokens]:
    email = normalize_email(email)
    _use_code(db, email, "signup", code)
    customer = db.scalar(select(Customer).where(Customer.email == email))
    if customer is None:
        raise ServiceError("That code has expired. Ask for a new one.", code="code_expired")
    customer.email_verified_at = customer.email_verified_at or utcnow()
    return customer, sessions.start(db, "customer", customer.id, context)


def login(db: Session, *, email: str, password: str, context: RequestContext) -> tuple[Customer, IssuedTokens]:
    customer = db.scalar(select(Customer).where(Customer.email == normalize_email(email)))
    if not verify_password(customer.password_hash if customer else None, password):
        raise NotAuthenticated(INVALID_LOGIN, code="invalid_credentials")
    assert customer is not None
    if customer.email_verified_at is None:
        raise Forbidden("Enter the code we emailed you to finish signing up.", code="email_not_verified")
    return customer, sessions.start(db, "customer", customer.id, context)


def request_reset(db: Session, *, email: str) -> str | None:
    """Returns the code to email, or None if there's no account. Callers answer the same way either way."""
    email = normalize_email(email)
    if db.scalar(select(Customer.id).where(Customer.email == email)) is None:
        return None
    return _issue_code(db, email, "reset")


def confirm_reset(db: Session, *, email: str, code: str, new_password: str) -> None:
    email = normalize_email(email)
    _use_code(db, email, "reset", code)
    customer = db.scalar(select(Customer).where(Customer.email == email))
    if customer is None:
        raise ServiceError("That code has expired. Ask for a new one.", code="code_expired")
    customer.password_hash = hash_password(new_password)
    # The code proves they can read this inbox.
    customer.email_verified_at = customer.email_verified_at or utcnow()
    sessions.revoke_all(db, "customer", customer.id)
