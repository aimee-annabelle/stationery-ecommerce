"""Public catalog. Products and search arrive with the shop in stage 3."""

from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from app.api.deps import DB
from app.core.storage import FileStorage, LocalFileStorage, get_storage
from app.schemas.catalog import CategoryOut
from app.services import catalog
from app.services.errors import NotFound

router = APIRouter(tags=["catalog"])


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: DB) -> list[CategoryOut]:
    return [CategoryOut.model_validate(c) for c in catalog.list_categories(db)]


# Mounted at the site root, not under /api/v1, because stored photo URLs look like /media/products/<file>.
media_router = APIRouter(tags=["media"])


@media_router.get("/media/products/{filename}", include_in_schema=False)
def product_photo(filename: str, storage: Annotated[FileStorage, Depends(get_storage)]) -> FileResponse:
    """Product photos are public. Other upload folders (print-request files) are never served from here.
    Only used with local storage; S3 storage would serve its own URLs."""
    if not isinstance(storage, LocalFileStorage):
        raise NotFound("Photo not found.")
    try:
        path = storage.path_for(f"products/{filename}")
    except ValueError:
        raise NotFound("Photo not found.") from None
    if "/" in filename or not path.is_file():
        raise NotFound("Photo not found.")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})
