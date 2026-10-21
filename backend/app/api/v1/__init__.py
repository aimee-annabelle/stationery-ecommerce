from fastapi import APIRouter
from sqlalchemy import text

from app.api.deps import DB
from app.api.v1 import auth, catalog, staff_auth, staff_catalog

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router)
router.include_router(staff_auth.router)
router.include_router(catalog.router)
router.include_router(staff_catalog.router)


@router.get("/health", tags=["health"])
def health(db: DB) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
