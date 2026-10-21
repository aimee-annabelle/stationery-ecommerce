"""Read access to the settings table (keys are listed in app.seed). Editing comes with S8 in stage 6."""

from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Setting

KIGALI = ZoneInfo("Africa/Kigali")
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
PICKUP_DAYS_AHEAD = 14


def get(db: Session, key: str, default: Any = None) -> Any:
    value = db.scalar(select(Setting.value).where(Setting.key == key))
    return default if value is None else value


def today_in_kigali() -> date:
    return datetime.now(KIGALI).date()


def payment_methods(db: Session) -> dict[str, dict]:
    return get(db, "payment_methods", {})


def method_enabled(db: Session, method: str) -> bool:
    return bool(payment_methods(db).get(method, {}).get("enabled"))


def is_open_on(db: Session, day: date) -> bool:
    hours = get(db, "hours", {})
    if hours.get(WEEKDAYS[day.weekday()], {}).get("closed"):
        return False
    return day.isoformat() not in set(get(db, "closures", []))


def pickup_days(db: Session) -> list[date]:
    """Days a customer can choose: today and the next 14 days, skipping closed days."""
    today = today_in_kigali()
    days = (today + timedelta(days=n) for n in range(PICKUP_DAYS_AHEAD + 1))
    return [day for day in days if is_open_on(db, day)]


def public(db: Session) -> dict[str, Any]:
    """What the shop and checkout may show. Nothing here is secret."""
    shop = get(db, "shop", {})
    methods = payment_methods(db)
    return {
        "shop": {k: shop.get(k) for k in ("name", "address", "phone", "whatsapp", "email")},
        "hours": get(db, "hours", {}),
        "payment_methods": {
            "momo": {"enabled": bool(methods.get("momo", {}).get("enabled")), "merchant_code": methods.get("momo", {}).get("merchant_code")},
            "airtel": {"enabled": bool(methods.get("airtel", {}).get("enabled")), "merchant_code": methods.get("airtel", {}).get("merchant_code")},
            "pay_at_pickup": {"enabled": bool(methods.get("pay_at_pickup", {}).get("enabled"))},
        },
        "allow_guest_checkout": bool(get(db, "orders", {}).get("allow_guest_checkout", True)),
        "pickup_hold_days": get(db, "orders", {}).get("pickup_hold_days", 3),
        "pickup_days": [d.isoformat() for d in pickup_days(db)],
        "returns_policy": get(db, "receipt", {}).get("returns_policy"),
    }
