import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.config import get_settings
from app.core.phone import normalize_phone

CODE_PATTERN = r"^\s*\d{6}\s*$"


def _check_password(value: str) -> str:
    minimum = get_settings().password_min_length
    if len(value) < minimum:
        raise ValueError(f"Use at least {minimum} characters.")
    return value


class SignupIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str
    email: EmailStr
    password: str = Field(max_length=128)
    marketing_opt_in: bool = False

    _password = field_validator("password")(_check_password)
    _phone = field_validator("phone")(normalize_phone)


class VerifyIn(BaseModel):
    email: EmailStr
    code: str = Field(pattern=CODE_PATTERN)


class LoginIn(BaseModel):
    # Not EmailStr: logging in only looks the address up, and staff may have addresses (such as the
    # .test seed accounts) that strict validation rejects.
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)


class ResetRequestIn(BaseModel):
    email: EmailStr


class ResetConfirmIn(BaseModel):
    email: EmailStr
    code: str = Field(pattern=CODE_PATTERN)
    new_password: str = Field(max_length=128)

    _password = field_validator("new_password")(_check_password)


class MessageOut(BaseModel):
    message: str


class CustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    phone: str
    email: str
    email_verified_at: datetime | None
    marketing_opt_in: bool


class StaffOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    phone: str
    email: str
    role: str
    capabilities: list[str]


class CustomerTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    customer: CustomerOut


class StaffTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    staff: StaffOut
