import uuid
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.permissions import Capability, has_capability
from app.core.ratelimit import client_ip
from app.core.security import AccountType, decode_access_token
from app.models import Customer, Staff
from app.services import sessions
from app.services.context import RequestContext

DB = Annotated[Session, Depends(get_db)]

_bearer = HTTPBearer(auto_error=False)
Bearer = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]

NOT_SIGNED_IN = "Please log in."
NO_ACCESS = "You don't have access to this. Ask the owner if you need it."


def request_context(request: Request) -> RequestContext:
    return RequestContext(device=request.headers.get("user-agent"), ip=client_ip(request))


Context = Annotated[RequestContext, Depends(request_context)]


def _account_id(db: Session, credentials: HTTPAuthorizationCredentials | None, account_type: AccountType) -> uuid.UUID:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=NOT_SIGNED_IN)
    try:
        claims = decode_access_token(credentials.credentials, account_type)
        account_id, session_id = uuid.UUID(claims["sub"]), uuid.UUID(claims["sid"])
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=NOT_SIGNED_IN) from None
    # Logging out or losing access ends the session at once, not when the access token expires.
    if not sessions.is_active(db, session_id):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=NOT_SIGNED_IN)
    return account_id


def current_customer(db: DB, credentials: Bearer) -> Customer:
    customer = db.get(Customer, _account_id(db, credentials, "customer"))
    if customer is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=NOT_SIGNED_IN)
    return customer


def current_staff(db: DB, credentials: Bearer) -> Staff:
    staff = db.get(Staff, _account_id(db, credentials, "staff"))
    if staff is None or not staff.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=NOT_SIGNED_IN)
    return staff


CurrentCustomer = Annotated[Customer, Depends(current_customer)]


def require(capability: Capability | None):
    """Guard for every staff route. `require(Capability.ORDERS_CANCEL)` returns the signed-in staff member
    or answers 403. `require(None)` admits any active staff member (for /staff/me and the dashboard).

    tests/test_permissions.py fails if a /staff route has no guard, so every route must use this.
    """

    def guard(staff: Annotated[Staff, Depends(current_staff)]) -> Staff:
        if capability is not None and not has_capability(staff.role, capability):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail=NO_ACCESS)
        return staff

    guard.staff_capability = capability  # type: ignore[attr-defined]
    return guard


AnyStaff = Annotated[Staff, Depends(require(None))]
