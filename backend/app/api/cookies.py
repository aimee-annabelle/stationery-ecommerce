from fastapi import Response

from app.core.config import get_settings
from app.core.security import AccountType

# Each cookie is only sent to its own auth routes, and customers and staff use different names.
REFRESH_COOKIES: dict[AccountType, tuple[str, str]] = {
    "customer": ("ph_refresh", "/api/v1/auth"),
    "staff": ("ph_staff_refresh", "/api/v1/staff/auth"),
}


def set_refresh_cookie(response: Response, account_type: AccountType, token: str, max_age: int) -> None:
    name, path = REFRESH_COOKIES[account_type]
    response.set_cookie(
        name,
        token,
        max_age=max_age,
        path=path,
        httponly=True,
        secure=get_settings().cookie_secure,
        samesite="lax",
    )


def clear_refresh_cookie(response: Response, account_type: AccountType) -> None:
    name, path = REFRESH_COOKIES[account_type]
    response.delete_cookie(name, path=path, httponly=True, secure=get_settings().cookie_secure, samesite="lax")
