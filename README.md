# Pahyems Store

Online shop with in-store pickup, plus a staff back office, for Pahyems Company Ltd (Huye – Tumba Center).
The specification is [HANDOFF.md](HANDOFF.md); the approved screens are in [design/](design/README.md).

## Run it

```bash
cp .env.example .env
docker compose up --build
docker compose exec api python -m app.seed
```

| What | Where |
| --- | --- |
| Shop (Vite dev server) | http://localhost:5173 |
| API docs (OpenAPI) | http://localhost:8000/docs |
| Emails sent in development (Mailpit) | http://localhost:8025 |

Seeded staff (development only) sign in with the password in `SEED_STAFF_PASSWORD` (`.env.example`):
`patrick@pahyems.test` (owner), `eric@pahyems.test` (manager), `grace@pahyems.test` and `diane@pahyems.test` (workers).

## Tests

```bash
docker compose exec api pytest
```

Tests use the `pahyems_test` database, rebuilt from the migrations on every run.

## Migrations

```bash
docker compose exec api alembic revision --autogenerate -m "describe the change"
docker compose exec api alembic upgrade head
```

The API applies migrations when it starts.

## Where things live

- `backend/app/core/permissions.py`: staff capabilities mapped to roles. Every staff route uses `require(Capability...)`.
- `backend/app/services/audit.py`: the activity log. Every staff change calls `audit.record(...)` before the commit.
- `backend/app/services/notifications.py`: the `Notifier` interface for emails.
- `backend/app/seed.py`: sample data from the designs. Anything in `[SQUARE BRACKETS]` is waiting for the owner.
- `frontend/src/styles/tokens.css`: design tokens. `frontend/src/strings.ts`: all UI text.

## Build progress

1. Foundation: done.
2. Catalog and stock: next.
