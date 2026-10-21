"""Tests run against a real Postgres database (TEST_DATABASE_URL), migrated once per run with Alembic.
Each test runs inside a transaction that is rolled back afterwards."""

import os

os.environ["ENVIRONMENT"] = "test"
os.environ["NOTIFIER"] = "console"

from collections.abc import Iterator  # noqa: E402
from dataclasses import dataclass, field  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import Engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.db import get_db  # noqa: E402
from app.core.ratelimit import limiter  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Staff  # noqa: E402
from app.services.notifications import Email, get_notifier  # noqa: E402

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAFF_PASSWORD = "staff-password-1"


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    url = get_settings().test_database_url
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    config = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    config.cmd_opts = type("Opts", (), {"x": [f"url={url}"]})()
    command.upgrade(config, "head")
    yield engine
    engine.dispose()


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False)
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@dataclass
class RecordingNotifier:
    sent: list[Email] = field(default_factory=list)

    def send_email(self, email: Email) -> None:
        self.sent.append(email)

    def last_code(self, to: str) -> str:
        email = next(e for e in reversed(self.sent) if e.to == to)
        return next(word for word in email.body.split() if word.isdigit() and len(word) == 6)


@pytest.fixture
def notifier() -> RecordingNotifier:
    return RecordingNotifier()


@pytest.fixture
def client(db: Session, notifier: RecordingNotifier) -> Iterator[TestClient]:
    limiter.reset()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_notifier] = lambda: notifier
    with TestClient(app, headers={"User-Agent": "pytest-browser"}) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def team(db: Session) -> dict[str, Staff]:
    """One staff member per role, all with STAFF_PASSWORD."""
    password_hash = hash_password(STAFF_PASSWORD)
    members = {
        role: Staff(
            name=f"Test {role}",
            phone=f"25078800010{i}",
            email=f"{role}@staff.test",
            role=role,
            password_hash=password_hash,
        )
        for i, role in enumerate(("owner", "manager", "worker"))
    }
    db.add_all(members.values())
    db.flush()
    return members


def staff_token(client: TestClient, member: Staff) -> str:
    response = client.post("/api/v1/staff/auth/login", json={"email": member.email, "password": STAFF_PASSWORD})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
