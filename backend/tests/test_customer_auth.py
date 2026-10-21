from datetime import timedelta

from sqlalchemy import select, update

from app.core.security import utcnow
from app.models import Customer, VerificationCode
from tests.conftest import bearer

EMAIL = "aline@example.com"
PASSWORD = "notebook-2026"
SIGNUP = {"name": "Aline U.", "phone": "0788 123 456", "email": EMAIL, "password": PASSWORD}


def sign_up_and_verify(client, notifier) -> dict:
    assert client.post("/api/v1/auth/signup", json=SIGNUP).status_code == 202
    response = client.post("/api/v1/auth/verify", json={"email": EMAIL, "code": notifier.last_code(EMAIL)})
    assert response.status_code == 200, response.text
    return response.json()


def test_signup_emails_a_code_and_stores_phone_in_international_form(client, db, notifier):
    response = client.post("/api/v1/auth/signup", json={**SIGNUP, "email": "Aline@Example.com"})

    assert response.status_code == 202
    assert notifier.sent[-1].to == EMAIL
    assert "Your Pahyems code is" in notifier.sent[-1].body
    customer = db.scalar(select(Customer).where(Customer.email == EMAIL))
    assert customer.phone == "250788123456"
    assert customer.email_verified_at is None
    assert customer.password_hash != PASSWORD


def test_signup_rejects_bad_phone_and_short_password(client):
    assert client.post("/api/v1/auth/signup", json={**SIGNUP, "phone": "12345"}).status_code == 422
    assert client.post("/api/v1/auth/signup", json={**SIGNUP, "password": "short"}).status_code == 422


def test_login_is_blocked_until_email_is_verified(client):
    client.post("/api/v1/auth/signup", json=SIGNUP)

    response = client.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})

    assert response.status_code == 403
    assert response.json()["code"] == "email_not_verified"


def test_verify_signs_in_and_sets_refresh_cookie(client, notifier):
    body = sign_up_and_verify(client, notifier)

    assert body["customer"]["email_verified_at"] is not None
    assert client.cookies.get("ph_refresh")
    me = client.get("/api/v1/me", headers=bearer(body["access_token"]))
    assert me.status_code == 200
    assert me.json()["email"] == EMAIL


def test_signup_with_a_verified_email_is_refused(client, notifier):
    sign_up_and_verify(client, notifier)

    response = client.post("/api/v1/auth/signup", json=SIGNUP)

    assert response.status_code == 409


def test_wrong_code_is_refused_and_code_dies_after_five_tries(client, notifier):
    client.post("/api/v1/auth/signup", json=SIGNUP)
    good = notifier.last_code(EMAIL)
    wrong = "000000" if good != "000000" else "111111"

    for _ in range(4):
        response = client.post("/api/v1/auth/verify", json={"email": EMAIL, "code": wrong})
        assert response.json()["code"] == "code_invalid"
    assert client.post("/api/v1/auth/verify", json={"email": EMAIL, "code": wrong}).json()["code"] == "code_locked"

    response = client.post("/api/v1/auth/verify", json={"email": EMAIL, "code": good})
    assert response.json()["code"] == "code_expired"


def test_expired_code_is_refused(client, db, notifier):
    client.post("/api/v1/auth/signup", json=SIGNUP)
    db.execute(update(VerificationCode).values(expires_at=utcnow() - timedelta(seconds=1)))

    response = client.post("/api/v1/auth/verify", json={"email": EMAIL, "code": notifier.last_code(EMAIL)})

    assert response.json()["code"] == "code_expired"


def test_code_works_only_once_and_a_new_code_replaces_the_old(client, notifier):
    client.post("/api/v1/auth/signup", json=SIGNUP)
    first = notifier.last_code(EMAIL)
    client.post("/api/v1/auth/signup", json=SIGNUP)
    second = notifier.last_code(EMAIL)

    if first != second:
        assert client.post("/api/v1/auth/verify", json={"email": EMAIL, "code": first}).status_code == 400
    assert client.post("/api/v1/auth/verify", json={"email": EMAIL, "code": second}).status_code == 200
    assert client.post("/api/v1/auth/verify", json={"email": EMAIL, "code": second}).status_code == 400


def test_wrong_password_and_unknown_email_get_the_same_answer(client, notifier):
    sign_up_and_verify(client, notifier)

    wrong = client.post("/api/v1/auth/login", json={"email": EMAIL, "password": "not-the-password"})
    unknown = client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": PASSWORD})

    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_refresh_replaces_the_refresh_token(client, notifier):
    sign_up_and_verify(client, notifier)
    old_cookie = client.cookies.get("ph_refresh")

    response = client.post("/api/v1/auth/refresh")

    assert response.status_code == 200
    new_cookie = client.cookies.get("ph_refresh")
    assert new_cookie != old_cookie
    client.cookies.set("ph_refresh", old_cookie, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_logout_ends_the_session_at_once(client, notifier):
    body = sign_up_and_verify(client, notifier)
    cookie = client.cookies.get("ph_refresh")

    assert client.post("/api/v1/auth/logout").status_code == 204

    assert client.get("/api/v1/me", headers=bearer(body["access_token"])).status_code == 401
    client.cookies.set("ph_refresh", cookie, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_reset_for_unknown_email_looks_the_same_and_sends_nothing(client, notifier):
    response = client.post("/api/v1/auth/reset/request", json={"email": "nobody@example.com"})

    assert response.status_code == 202
    assert notifier.sent == []


def test_password_reset_changes_password_and_signs_out_everywhere(client, notifier):
    body = sign_up_and_verify(client, notifier)

    assert client.post("/api/v1/auth/reset/request", json={"email": EMAIL}).status_code == 202
    assert "Your reset code is" in notifier.sent[-1].body
    response = client.post(
        "/api/v1/auth/reset/confirm",
        json={"email": EMAIL, "code": notifier.last_code(EMAIL), "new_password": "new-password-99"},
    )

    assert response.status_code == 200
    assert client.get("/api/v1/me", headers=bearer(body["access_token"])).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": EMAIL, "password": "new-password-99"}).status_code == 200


def test_login_is_rate_limited(client):
    for _ in range(10):
        client.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})

    response = client.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})

    assert response.status_code == 429
