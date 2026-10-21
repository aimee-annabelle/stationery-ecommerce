"""S8 Shop settings: read and change, owner only. Every section is checked here, and each save writes one
"settings.updated" activity log entry (sensitive, log only) with the values before and after."""

import re
from datetime import date
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.phone import normalize_phone
from app.models import Setting, Staff
from app.services import audit, shop_settings
from app.services.context import RequestContext
from app.services.errors import ServiceError

TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ShopSection(Strict):
    name: str = Field(min_length=2, max_length=120)
    address: str = Field(min_length=2, max_length=200)
    phone: str
    whatsapp: str
    email: str = Field(max_length=254)
    tin: str = Field(max_length=40)

    _phones = field_validator("phone", "whatsapp")(normalize_phone)


class Day(Strict):
    open: str = Field(max_length=20)
    close: str = Field(max_length=20)
    closed: bool

    @model_validator(mode="after")
    def _times(self) -> "Day":
        if not self.closed:
            for value in (self.open, self.close):
                if not (TIME.match(value) or value.startswith("[")):
                    raise ValueError("Use times like 08:00.")
            if TIME.match(self.open) and TIME.match(self.close) and self.open >= self.close:
                raise ValueError("Closing time must be after opening time.")
        return self


class HoursSection(Strict):
    mon: Day
    tue: Day
    wed: Day
    thu: Day
    fri: Day
    sat: Day
    sun: Day


class Method(Strict):
    enabled: bool
    merchant_code: str = Field(default="", max_length=40)


class PickupMethod(Strict):
    enabled: bool


class PaymentsSection(Strict):
    momo: Method
    airtel: Method
    pay_at_pickup: PickupMethod

    @model_validator(mode="after")
    def _one_on(self) -> "PaymentsSection":
        if not (self.momo.enabled or self.airtel.enabled or self.pay_at_pickup.enabled):
            raise ValueError("Keep at least one way to pay switched on.")
        return self


class OrdersSection(Strict):
    allow_guest_checkout: bool
    whatsapp_ready_button: bool
    pickup_hold_days: int = Field(ge=1, le=30)
    default_low_stock_alert: int = Field(ge=0, le=1000)


class TemplatesSection(Strict):
    order_ready: str = Field(min_length=1, max_length=600)
    payment_rejected: str = Field(min_length=1, max_length=600)
    print_quote: str = Field(min_length=1, max_length=600)
    print_ready: str = Field(min_length=1, max_length=600)
    general: str = Field(min_length=1, max_length=600)
    receipt: str = Field(min_length=1, max_length=600)


class ReceiptSection(Strict):
    footer: str = Field(max_length=200)
    returns_policy: str = Field(max_length=600)
    show_tin: bool
    email_after_payment: bool


class AlertsSection(Strict):
    email: str = Field(default="", max_length=254)
    daily_time: str
    cancel: bool
    price: bool
    stock: bool
    daily: bool
    login: bool
    staff: bool

    @field_validator("daily_time")
    @classmethod
    def _time(cls, value: str) -> str:
        if not TIME.match(value):
            raise ValueError("Use a time like 23:59.")
        return value

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        value = value.strip().lower()
        if value and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", value):
            raise ValueError("Check the email address, or leave it empty to use the owner's.")
        return value


SECTIONS: dict[str, type[BaseModel]] = {
    "shop": ShopSection,
    "hours": HoursSection,
    "payment_methods": PaymentsSection,
    "orders": OrdersSection,
    "message_templates": TemplatesSection,
    "receipt": ReceiptSection,
    "owner_alerts": AlertsSection,
}


def read_all(db: Session) -> dict[str, Any]:
    values = {key: shop_settings.get(db, key, {}) for key in SECTIONS}
    values["closures"] = shop_settings.get(db, "closures", [])
    return values


def _changed_keys(old: Any, new: Any) -> dict[str, tuple[Any, Any]]:
    if isinstance(old, dict) and isinstance(new, dict):
        return {k: (old.get(k), new.get(k)) for k in set(old) | set(new) if old.get(k) != new.get(k)}
    return {} if old == new else {"value": (old, new)}


def update(db: Session, actor: Staff, changes: dict[str, Any], context: RequestContext) -> dict[str, Any]:
    """Replaces whole sections. Unknown sections or fields are refused."""
    unknown = set(changes) - set(SECTIONS) - {"closures"}
    if unknown:
        raise ServiceError(f"Unknown settings: {', '.join(sorted(unknown))}.", code="unknown_setting")

    cleaned: dict[str, Any] = {}
    try:
        for key, value in changes.items():
            if key == "closures":
                days = sorted({date.fromisoformat(str(d)).isoformat() for d in value})
                cleaned[key] = days
            else:
                cleaned[key] = SECTIONS[key].model_validate(value).model_dump()
    except (ValidationError, ValueError) as error:
        first = error.errors()[0] if isinstance(error, ValidationError) else {"msg": str(error), "loc": ()}
        where = ".".join(str(p) for p in first.get("loc", ()))
        message = str(first["msg"]).removeprefix("Value error, ")
        raise ServiceError(f"{key}{'.' + where if where else ''}: {message}", code="invalid_setting") from None

    before: dict[str, Any] = {}
    after: dict[str, Any] = {}
    for key, value in cleaned.items():
        row = db.scalar(select(Setting).where(Setting.key == key))
        old = row.value if row else None
        diff = _changed_keys(old, value)
        if not diff:
            continue
        before[key] = {k: v[0] for k, v in diff.items()}
        after[key] = {k: v[1] for k, v in diff.items()}
        if row is None:
            db.add(Setting(key=key, value=value))
        else:
            row.value = value
    db.flush()
    if after:
        audit.record(db, actor, "settings.updated", entity_type="settings", entity_label="Shop settings",
                     before=before, after=after, context=context)
    return read_all(db)

