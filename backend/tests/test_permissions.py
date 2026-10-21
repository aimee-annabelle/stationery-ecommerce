"""The permission table from HANDOFF.md, checked for each role against each capability-guarded route."""

import pytest
from fastapi import APIRouter, Depends
from fastapi.routing import APIRoute

from app.api.deps import require
from app.core.permissions import ROLE_CAPABILITIES, Capability, Role
from app.main import app
from tests.conftest import bearer, staff_token

C = Capability
# Copied by hand from HANDOFF.md "Users, roles and permissions", so a change to the code table
# must also change this one.
EXPECTED = {
    C.ORDERS_CREATE: {"owner", "manager", "worker"},
    C.ORDERS_UPDATE_STATUS: {"owner", "manager", "worker"},
    C.PAYMENTS_VERIFY: {"owner", "manager", "worker"},
    C.ORDERS_CANCEL: {"owner", "manager"},
    C.ORDERS_REFUND: {"owner", "manager"},
    C.PRINT_REQUESTS_MANAGE: {"owner", "manager", "worker"},
    C.PRODUCTS_VIEW: {"owner", "manager", "worker"},
    C.PRODUCTS_EDIT: {"owner", "manager"},
    C.STOCK_MANAGE: {"owner", "manager"},
    C.COSTS_VIEW: {"owner", "manager"},
    C.REPORTS_VIEW: {"owner"},
    C.ACTIVITY_VIEW: {"owner"},
    C.STAFF_MANAGE: {"owner"},
    C.SETTINGS_MANAGE: {"owner"},
}


def test_role_table_matches_the_spec():
    assert set(EXPECTED) == set(Capability)
    for capability, roles in EXPECTED.items():
        actual = {role.value for role in Role if capability in ROLE_CAPABILITIES[role]}
        assert actual == roles, capability


def _guards(dependant) -> list:
    found = [d.call for d in dependant.dependencies if hasattr(d.call, "staff_capability")]
    for sub in dependant.dependencies:
        found += _guards(sub)
    return found


def test_every_staff_route_declares_a_guard():
    staff_routes = [
        route
        for route in app.routes
        if isinstance(route, APIRoute)
        and route.path.startswith("/api/v1/staff")
        and not route.path.startswith("/api/v1/staff/auth/")
    ]
    assert staff_routes, "expected at least /staff/me"
    missing = [f"{sorted(r.methods)} {r.path}" for r in staff_routes if not _guards(r.dependant)]
    assert missing == [], "Staff routes without require(...): " + ", ".join(missing)


@pytest.fixture
def guarded_client(client):
    """Adds one throwaway route per capability, guarded exactly as real staff routes are."""
    router = APIRouter(prefix="/api/v1/staff/_test")
    for capability in Capability:

        def endpoint(staff=Depends(require(capability))) -> dict:
            return {"ok": True}

        router.add_api_route(f"/{capability.value}", endpoint, methods=["GET"])
    count = len(app.router.routes)
    app.include_router(router)  # on the real app, so test database overrides apply
    yield client
    del app.router.routes[count:]


@pytest.mark.parametrize("role", ["owner", "manager", "worker"])
def test_each_role_against_each_capability(guarded_client, team, role):
    token = staff_token(guarded_client, team[role])

    for capability, allowed_roles in EXPECTED.items():
        response = guarded_client.get(f"/api/v1/staff/_test/{capability.value}", headers=bearer(token))
        expected = 200 if role in allowed_roles else 403
        assert response.status_code == expected, f"{role} -> {capability}: {response.status_code}"


def test_signed_out_requests_get_401(guarded_client):
    for capability in Capability:
        assert guarded_client.get(f"/api/v1/staff/_test/{capability.value}").status_code == 401
    assert guarded_client.get("/api/v1/staff/me").status_code == 401
