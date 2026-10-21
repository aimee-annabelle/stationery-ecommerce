"""Customer auth: POST /auth/signup, /verify, /login, /refresh, /reset/request, /reset/confirm, /logout."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, Response, status

from app.api.cookies import REFRESH_COOKIES, clear_refresh_cookie, set_refresh_cookie
from app.api.deps import DB, Context, CurrentCustomer
from app.core.config import get_settings
from app.core.ratelimit import rate_limit
from app.models import Customer
from app.schemas.auth import (
    CustomerOut,
    CustomerTokenOut,
    LoginIn,
    MessageOut,
    ResetConfirmIn,
    ResetRequestIn,
    SignupIn,
    VerifyIn,
)
from app.services import customer_auth, sessions
from app.services.errors import NotAuthenticated
from app.services.notifications import Notifier, get_notifier, reset_code_email, send_later, signup_code_email
from app.services.sessions import IssuedTokens

router = APIRouter(tags=["customer auth"])

RefreshCookie = Annotated[str | None, Cookie(alias=REFRESH_COOKIES["customer"][0])]
NotifierDep = Annotated[Notifier, Depends(get_notifier)]


def _signed_in(response: Response, customer, tokens: IssuedTokens) -> CustomerTokenOut:
    set_refresh_cookie(response, "customer", tokens.refresh_token, tokens.refresh_max_age)
    return CustomerTokenOut(
        access_token=tokens.access_token,
        expires_in=get_settings().access_token_minutes * 60,
        customer=CustomerOut.model_validate(customer),
    )


@router.post(
    "/auth/signup",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=MessageOut,
    dependencies=[Depends(rate_limit("signup", 5, 15 * 60))],
)
def signup(body: SignupIn, db: DB, background: BackgroundTasks, notifier: NotifierDep) -> MessageOut:
    customer, code = customer_auth.signup(
        db,
        name=body.name,
        phone=body.phone,
        email=body.email,
        password=body.password,
        marketing_opt_in=body.marketing_opt_in,
    )
    db.commit()
    send_later(background, notifier, signup_code_email(customer.email, code))
    return MessageOut(message="We emailed you a 6-digit code.")


@router.post(
    "/auth/verify",
    response_model=CustomerTokenOut,
    dependencies=[Depends(rate_limit("verify", 10, 15 * 60))],
)
def verify(body: VerifyIn, db: DB, context: Context, response: Response) -> CustomerTokenOut:
    customer, tokens = customer_auth.verify_signup(db, email=body.email, code=body.code, context=context)
    db.commit()
    return _signed_in(response, customer, tokens)


@router.post(
    "/auth/login",
    response_model=CustomerTokenOut,
    dependencies=[Depends(rate_limit("login", 10, 5 * 60))],
)
def login(body: LoginIn, db: DB, context: Context, response: Response) -> CustomerTokenOut:
    customer, tokens = customer_auth.login(db, email=body.email, password=body.password, context=context)
    db.commit()
    return _signed_in(response, customer, tokens)


@router.post("/auth/refresh", response_model=CustomerTokenOut)
def refresh(db: DB, context: Context, response: Response, refresh_token: RefreshCookie = None) -> CustomerTokenOut:
    session = sessions.find_active(db, refresh_token, "customer")
    customer = db.get(Customer, session.customer_id)
    if customer is None:
        raise NotAuthenticated("Please log in again.")
    tokens = sessions.refresh(db, session, context)
    db.commit()
    return _signed_in(response, customer, tokens)


@router.post(
    "/auth/reset/request",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=MessageOut,
    dependencies=[Depends(rate_limit("reset", 5, 15 * 60))],
)
def reset_request(body: ResetRequestIn, db: DB, background: BackgroundTasks, notifier: NotifierDep) -> MessageOut:
    code = customer_auth.request_reset(db, email=body.email)
    db.commit()
    if code is not None:
        send_later(background, notifier, reset_code_email(customer_auth.normalize_email(body.email), code))
    # Same answer whether or not the account exists.
    return MessageOut(message="If that email has an account, we sent it a 6-digit code.")


@router.post(
    "/auth/reset/confirm",
    response_model=MessageOut,
    dependencies=[Depends(rate_limit("reset_confirm", 10, 15 * 60))],
)
def reset_confirm(body: ResetConfirmIn, db: DB) -> MessageOut:
    customer_auth.confirm_reset(db, email=body.email, code=body.code, new_password=body.new_password)
    db.commit()
    return MessageOut(message="Your password has been changed. Log in with your new password.")


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(db: DB, refresh_token: RefreshCookie = None) -> Response:
    try:
        sessions.revoke(sessions.find_active(db, refresh_token, "customer"))
        db.commit()
    except NotAuthenticated:
        pass
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_refresh_cookie(response, "customer")
    return response


@router.get("/me", response_model=CustomerOut)
def me(customer: CurrentCustomer) -> CustomerOut:
    return CustomerOut.model_validate(customer)
