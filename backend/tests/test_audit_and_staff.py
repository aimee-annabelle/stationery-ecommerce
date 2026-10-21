import uuid
from datetime import date

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models import ActivityLog, AuthSession, Staff
from app.seed import seed
from app.services import audit
from app.services import staff as staff_service
from app.services.context import RequestContext
from app.services.errors import Forbidden, ServiceError

CONTEXT = RequestContext(device="Mozilla/5.0 (Android)", ip="10.0.0.7")


def test_record_stores_who_what_device_and_ip(db, team):
    entity_id = uuid.uuid4()

    entry = audit.record(
        db, team["manager"], "product.price_changed",
        entity_type="product", entity_id=entity_id, entity_label="SKU OFF-003",
        before={"price_rwf": 9500}, after={"price_rwf": 9800, "on": date(2026, 10, 21)}, context=CONTEXT,
    )

    assert entry.staff_id == team["manager"].id
    assert entry.kind == "products"
    assert entry.is_sensitive is True
    assert entry.after == {"price_rwf": 9800, "on": "2026-10-21"}
    assert (entry.device, entry.ip) == (CONTEXT.device, CONTEXT.ip)


def test_non_sensitive_action(db, team):
    entry = audit.record(db, team["worker"], "order.status_changed", entity_type="order", entity_label="PH-0001")

    assert entry.is_sensitive is False
    assert entry.kind == "orders"


def test_unknown_action_is_refused(db, team):
    with pytest.raises(ValueError):
        audit.record(db, team["owner"], "order.teleported", entity_type="order")


def test_log_entry_is_saved_or_lost_together_with_the_change(db, team):
    before = db.scalar(select(func.count()).select_from(ActivityLog))
    savepoint = db.begin_nested()
    staff_service.change_role(db, team["owner"], team["worker"], "manager", CONTEXT)
    savepoint.rollback()

    assert db.scalar(select(func.count()).select_from(ActivityLog)) == before
    db.refresh(team["worker"])
    assert team["worker"].role == "worker"


@pytest.mark.parametrize(
    "statement",
    ["UPDATE activity_log SET action = 'x'", "DELETE FROM activity_log", "TRUNCATE activity_log CASCADE"],
)
def test_activity_log_is_append_only_in_the_database(db, team, statement):
    audit.record(db, team["owner"], "settings.updated", entity_type="settings")

    with pytest.raises(DBAPIError, match="append-only"):
        with db.begin_nested():
            db.execute(text(statement))


def test_stock_movements_are_append_only_in_the_database(db):
    seed(db)  # row triggers only fire when there are rows

    with pytest.raises(DBAPIError, match="append-only"):
        with db.begin_nested():
            db.execute(text("DELETE FROM stock_movements"))


def test_role_change_is_logged_as_sensitive_with_before_and_after(db, team):
    staff_service.change_role(db, team["owner"], team["worker"], "manager", CONTEXT)

    entry = db.scalar(select(ActivityLog).where(ActivityLog.action == "staff.role_changed"))
    assert entry.is_sensitive
    assert entry.before == {"role": "worker"}
    assert entry.after == {"role": "manager"}
    assert entry.entity_label == team["worker"].name


def test_removing_access_revokes_sessions_and_logs(db, team):
    db.add(AuthSession(account_type="staff", staff_id=team["worker"].id, refresh_token_hash="x" * 64,
                       expires_at=func.now() + text("interval '1 day'")))
    db.flush()

    staff_service.set_active(db, team["owner"], team["worker"], False, CONTEXT)

    assert db.scalar(select(AuthSession.revoked_at).where(AuthSession.staff_id == team["worker"].id)) is not None
    assert db.scalar(select(ActivityLog.action).where(ActivityLog.entity_id == team["worker"].id)) == (
        "staff.access_removed"
    )


@pytest.mark.parametrize("change", ["demote", "deactivate"])
def test_owner_cannot_be_demoted_or_locked_out(db, team, change):
    with pytest.raises(ServiceError) as error:
        if change == "demote":
            staff_service.change_role(db, team["owner"], team["owner"], "manager", CONTEXT)
        else:
            staff_service.set_active(db, team["owner"], team["owner"], False, CONTEXT)

    assert error.value.code == "owner_protected"


def test_nobody_can_be_promoted_to_owner(db, team):
    with pytest.raises(ServiceError):
        staff_service.change_role(db, team["owner"], team["manager"], "owner", CONTEXT)


def test_database_allows_only_one_owner(db, team):
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.add(Staff(name="Second", phone="250788000098", email="second@staff.test", role="owner"))
            db.flush()


def test_managers_cannot_change_staff(db, team):
    with pytest.raises(Forbidden):
        staff_service.change_role(db, team["manager"], team["worker"], "manager", CONTEXT)
    with pytest.raises(Forbidden):
        staff_service.set_active(db, team["manager"], team["worker"], False, CONTEXT)
