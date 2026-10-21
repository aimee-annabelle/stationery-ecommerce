import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings

AccountType = Literal["customer", "staff"]

_hasher = PasswordHasher()
_JWT_ALGORITHM = "HS256"
_ISSUER = "pahyems"


def utcnow() -> datetime:
    return datetime.now(UTC)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    if not password_hash:
        # Still spend the hashing time so missing accounts can't be told apart by timing.
        _hasher.hash(password)
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def create_access_token(account_type: AccountType, subject: uuid.UUID, session_id: uuid.UUID) -> str:
    now = utcnow()
    claims = {
        "iss": _ISSUER,
        "aud": account_type,
        "sub": str(subject),
        "sid": str(session_id),
        "iat": now,
        "exp": now + timedelta(minutes=get_settings().access_token_minutes),
    }
    return jwt.encode(claims, get_settings().jwt_secret, algorithm=_JWT_ALGORITHM)


def decode_access_token(token: str, account_type: AccountType) -> dict:
    """Raises jwt.InvalidTokenError if the token is invalid, expired, or meant for the other account type."""
    return jwt.decode(
        token,
        get_settings().jwt_secret,
        algorithms=[_JWT_ALGORITHM],
        audience=account_type,
        issuer=_ISSUER,
        options={"require": ["exp", "sub", "sid", "aud"]},
    )


def new_opaque_token() -> str:
    """Random token for refresh cookies and invite links. Only its hash is stored."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_verification_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_code(email: str, purpose: str, code: str) -> str:
    """Codes are only 6 digits, so they are hashed with a keyed hash tied to the email and purpose."""
    key = get_settings().jwt_secret.encode()
    return hashlib.blake2b(f"{email}|{purpose}|{code}".encode(), key=key[:64], digest_size=32).hexdigest()


def codes_match(a: str, b: str) -> bool:
    return secrets.compare_digest(a, b)
