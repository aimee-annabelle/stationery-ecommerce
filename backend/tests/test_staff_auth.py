from sqlalchemy import select

from app.models import ActivityLog, Staff
from app.services import staff as staff_service
from app.services.context import RequestContext
from tests.conftest import STAFF_PASSWORD, bearer, staff_token


def test_staff_login_returns_role_and_capabilities(client, team):
    response = client.post(
        "/api/v1/staff/auth/login", json={"email": team["worker"].email, "password": STAFF_PASSWORD}
    )

    assert response.status_code == 200
    staff = response.json()["staff"]
    assert staff["role"] == "worker"
    assert "products.view" in staff["capabilities"]
    assert "costs.view" not in staff["capabilities"]
    assert client.cookies.get("ph_staff_refresh")


def test_staff_me(client, team):
    token = staff_token(client, team["manager"])

    response = client.get("/api/v1/staff/me", headers=bearer(token))

    assert response.status_code == 200
    assert response.json()["email"] == team["manager"].email


def test_staff_and_customer_tokens_cannot_be_swapped(client, team, notifier):
    staff = staff_token(client, team["owner"])
    client.post(
        "/api/v1/auth/signup",
        json={"name": "Aline", "phone": "0788123456", "email": "a@example.com", "password": "password-1"},
    )
    customer = client.post(
        "/api/v1/auth/verify", json={"email": "a@example.com", "code": notifier.last_code("a@example.com")}
    ).json()["access_token"]

    assert client.get("/api/v1/me", headers=bearer(staff)).status_code == 401
    assert client.get("/api/v1/staff/me", headers=bearer(customer)).status_code == 401


def test_wrong_password_is_refused(client, team):
    response = client.post("/api/v1/staff/auth/login", json={"email": team["owner"].email, "password": "nope-nope"})

    assert response.status_code == 401


def test_invited_staff_without_a_password_cannot_log_in(client, db):
    db.add(Staff(name="New", phone="250788000099", email="new@staff.test", role="worker", password_hash=None))
    db.flush()

    response = client.post("/api/v1/staff/auth/login", json={"email": "new@staff.test", "password": "anything-1"})

    assert response.status_code == 401


def test_removing_access_signs_staff_out_at_once(client, db, team):
    token = staff_token(client, team["worker"])

    staff_service.set_active(db, team["owner"], team["worker"], False, RequestContext())
    db.flush()

    assert client.get("/api/v1/staff/me", headers=bearer(token)).status_code == 401
    assert client.post("/api/v1/staff/auth/refresh").status_code == 401
    response = client.post(
        "/api/v1/staff/auth/login", json={"email": team["worker"].email, "password": STAFF_PASSWORD}
    )
    assert response.status_code == 403
    assert response.json()["code"] == "access_removed"


def test_staff_refresh_and_logout(client, team):
    staff_token(client, team["worker"])

    assert client.post("/api/v1/staff/auth/refresh").status_code == 200
    assert client.post("/api/v1/staff/auth/logout").status_code == 204
    assert client.post("/api/v1/staff/auth/refresh").status_code == 401


def test_sign_in_on_a_new_device_is_logged_once_as_sensitive(client, db, team):
    def new_device_entries():
        return db.scalars(
            select(ActivityLog).where(
                ActivityLog.staff_id == team["manager"].id, ActivityLog.action == "staff.signed_in_new_device"
            )
        ).all()

    staff_token(client, team["manager"])
    staff_token(client, team["manager"])
    assert len(new_device_entries()) == 1
    assert new_device_entries()[0].is_sensitive

    client.headers["User-Agent"] = "another-phone"
    staff_token(client, team["manager"])
    assert len(new_device_entries()) == 2
