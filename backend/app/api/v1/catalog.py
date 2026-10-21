"""Public catalog: categories, products and product photos."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse

from app.api.deps import DB
from app.core.storage import FileStorage, LocalFileStorage, get_storage
from app.models import Product
from app.schemas.catalog import CategoryOut, ImageOut
from app.schemas.shop import (
    PublicCategoryOut,
    PublicProductCard,
    PublicProductOut,
    PublicProductPage,
    PublicVariantOut,
    Spec,
)
from app.services import catalog
from app.services.errors import NotFound

router = APIRouter(tags=["catalog"])


def card(product: Product) -> PublicProductCard:
    return PublicProductCard(
        id=product.id,
        slug=product.slug,
        name=product.name,
        category=CategoryOut.model_validate(product.category),
        price_rwf=product.price_rwf,
        availability=catalog.availability(product.stock_qty, product.low_stock_alert),
        image=product.images[0].url if product.images else None,
        has_variants=bool(product.variants),
    )


@router.get("/categories", response_model=list[PublicCategoryOut])
def list_categories(db: DB) -> list[PublicCategoryOut]:
    counts = catalog.visible_counts(db)
    return [
        PublicCategoryOut(**CategoryOut.model_validate(c).model_dump(), product_count=counts.get(c.id, 0))
        for c in catalog.list_categories(db)
    ]


@router.get("/products", response_model=PublicProductPage)
def list_products(
    db: DB,
    q: Annotated[str | None, Query(max_length=80)] = None,
    category: Annotated[list[str] | None, Query(description="Category slug; repeat for several")] = None,
    min_price: Annotated[int | None, Query(ge=0)] = None,
    max_price: Annotated[int | None, Query(ge=0)] = None,
    in_stock: bool = False,
    sort: Literal["featured", "az", "za"] = "featured",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=48)] = 12,
) -> PublicProductPage:
    filters = catalog.PublicFilters(
        q=q, categories=tuple(category or ()), min_price=min_price, max_price=max_price, in_stock=in_stock, sort=sort
    )
    items, total = catalog.list_public_products(db, filters, page, page_size)
    return PublicProductPage(items=[card(p) for p in items], total=total, page=page, page_size=page_size)


@router.get("/products/{slug}", response_model=PublicProductOut)
def get_product(slug: str, db: DB) -> PublicProductOut:
    product = catalog.get_public_product(db, slug)
    return PublicProductOut(
        **card(product).model_dump(),
        summary=product.summary,
        description=product.description,
        specs=[Spec(**s) for s in product.specs or []],
        images=[ImageOut.model_validate(i) for i in product.images],
        variants=[
            PublicVariantOut(id=v.id, name=v.name, swatch_hex=v.swatch_hex,
                             availability="out_of_stock" if v.stock_qty <= 0 else "in_stock")
            for v in product.variants
        ],
        related=[card(p) for p in catalog.related_products(db, product)],
    )


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
