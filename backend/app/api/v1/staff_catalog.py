"""S4 / M4: products, variants, photos, stock and categories for staff.

Viewing needs products.view (all staff). Changing products needs products.edit, stock needs stock.manage
(managers and the owner). Cost prices are only sent to staff with costs.view.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Query, Response, UploadFile, status
from sqlalchemy import func, select

from app.api.deps import DB, Context, require
from app.core.config import get_settings
from app.core.permissions import Capability, has_capability
from app.core.storage import FileStorage, get_storage
from app.models import Category, LowStockFlag, Order, Product, ProductVariant, Staff, StockMovement
from app.schemas.catalog import (
    AdjustIn,
    CategoryIn,
    CategoryOut,
    CategoryPatch,
    ImageOut,
    LowStockFlagOut,
    LowStockFlagResult,
    MovementOut,
    MovementPage,
    PhotoOrderIn,
    ProductIn,
    ProductPage,
    ProductPatch,
    ReceiveIn,
    StaffCategoryOut,
    StaffProductOut,
    VariantIn,
    VariantOut,
    VariantPatch,
)
from app.services import catalog, stock
from app.services.errors import NotFound, ServiceError
from app.services.notifications import Notifier, get_notifier, low_stock_email, send_later

router = APIRouter(prefix="/staff", tags=["staff catalog"])

Viewer = Annotated[Staff, Depends(require(Capability.PRODUCTS_VIEW))]
Editor = Annotated[Staff, Depends(require(Capability.PRODUCTS_EDIT))]
StockManager = Annotated[Staff, Depends(require(Capability.STOCK_MANAGE))]
Storage = Annotated[FileStorage, Depends(get_storage)]
NotifierDep = Annotated[Notifier, Depends(get_notifier)]

# Cost keys are left out of the JSON (not sent as null) for staff without costs.view.
HIDE_UNSET = {"response_model_exclude_unset": True}


def _sees_cost(staff: Staff) -> bool:
    return has_capability(staff.role, Capability.COSTS_VIEW)


def _staff_label(staff: Staff) -> str:
    return f"{staff.name} ({staff.role.capitalize()})"


def _product_out(db: DB, products: list[Product], viewer: Staff) -> list[StaffProductOut]:
    ids = [p.id for p in products]
    flags = {
        product_id: LowStockFlagOut(flagged_by=name, flagged_at=at)
        for product_id, name, at in db.execute(
            select(LowStockFlag.product_id, Staff.name, LowStockFlag.created_at)
            .join(Staff, Staff.id == LowStockFlag.flagged_by_staff_id)
            .where(LowStockFlag.product_id.in_(ids), LowStockFlag.cleared_at.is_(None))
        )
    }
    out = []
    for p in products:
        data = dict(
            id=p.id, name=p.name, slug=p.slug, sku=p.sku,
            category=CategoryOut.model_validate(p.category),
            description=p.description, price_rwf=p.price_rwf,
            stock_qty=p.stock_qty, low_stock_alert=p.low_stock_alert, is_low=p.is_low,
            location=p.location, is_visible=p.is_visible,
            images=[ImageOut.model_validate(i) for i in p.images],
            variants=[VariantOut.model_validate(v) for v in p.variants],
            low_stock_flag=flags.get(p.id),
        )
        if _sees_cost(viewer):
            data["cost_rwf"] = p.cost_rwf
        out.append(StaffProductOut(**data))
    return out


def _one(db: DB, product: Product, viewer: Staff) -> StaffProductOut:
    db.refresh(product)
    return _product_out(db, [product], viewer)[0]


# Products


@router.get("/products", response_model=ProductPage, **HIDE_UNSET)
def list_products(
    db: DB,
    viewer: Viewer,
    q: Annotated[str | None, Query(max_length=80)] = None,
    category_id: uuid.UUID | None = None,
    low: bool = False,
    visible: bool | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ProductPage:
    items, total = catalog.list_products(
        db, catalog.ProductFilters(q=q, category_id=category_id, low_only=low, visible=visible), page, page_size
    )
    return ProductPage(items=_product_out(db, items, viewer), total=total, page=page, page_size=page_size)


@router.get("/products/{product_id}", response_model=StaffProductOut, **HIDE_UNSET)
def get_product(product_id: uuid.UUID, db: DB, viewer: Viewer) -> StaffProductOut:
    return _product_out(db, [catalog.get_product(db, product_id)], viewer)[0]


@router.post("/products", response_model=StaffProductOut, status_code=status.HTTP_201_CREATED, **HIDE_UNSET)
def create_product(body: ProductIn, db: DB, editor: Editor, context: Context) -> StaffProductOut:
    has_stock = body.opening_stock > 0 or any(v.opening_stock for v in body.variants)
    if has_stock and not has_capability(editor.role, Capability.STOCK_MANAGE):
        raise ServiceError("You can't record stock.", code="forbidden", status_code=403)
    product = catalog.create_product(
        db, editor,
        name=body.name, category_id=body.category_id, price_rwf=body.price_rwf, cost_rwf=body.cost_rwf,
        sku=body.sku, opening_stock=body.opening_stock, low_stock_alert=body.low_stock_alert,
        description=body.description, location=body.location, is_visible=body.is_visible,
        variants=[catalog.NewVariant(v.name, v.swatch_hex, v.opening_stock) for v in body.variants],
        context=context,
    )
    db.commit()
    return _one(db, product, editor)


@router.patch("/products/{product_id}", response_model=StaffProductOut, **HIDE_UNSET)
def update_product(product_id: uuid.UUID, body: ProductPatch, db: DB, editor: Editor, context: Context) -> StaffProductOut:
    changes = body.model_dump(exclude_unset=True)
    for required in ("name", "category_id", "price_rwf", "sku", "low_stock_alert", "description", "is_visible"):
        if required in changes and changes[required] is None:
            raise ServiceError(f"{required.replace('_', ' ').capitalize()} can't be empty.", code="required")
    product = catalog.update_product(db, editor, catalog.get_product(db, product_id), changes, context)
    db.commit()
    return _one(db, product, editor)


@router.post("/products/{product_id}/low-stock-flag", response_model=LowStockFlagResult)
def flag_low_stock(
    product_id: uuid.UUID, db: DB, viewer: Viewer, context: Context, background: BackgroundTasks, notifier: NotifierDep
) -> LowStockFlagResult:
    product = catalog.get_product(db, product_id)
    flag, recipients = stock.flag_low_stock(db, viewer, product, context)
    flagged_by = db.get(Staff, flag.flagged_by_staff_id)
    db.commit()
    for person in recipients:
        send_later(background, notifier, low_stock_email(
            person.email, product_name=product.name, sku=product.sku, stock_qty=product.stock_qty,
            alert=product.low_stock_alert, flagged_by=viewer.name,
        ))
    return LowStockFlagResult(
        flagged_by=flagged_by.name if flagged_by else "",
        flagged_at=flag.created_at,
        notified=[_staff_label(p) for p in recipients],
        already_flagged=not recipients,
    )


# Variants


@router.post("/products/{product_id}/variants", response_model=StaffProductOut, status_code=201, **HIDE_UNSET)
def add_variant(product_id: uuid.UUID, body: VariantIn, db: DB, editor: Editor, context: Context) -> StaffProductOut:
    if body.opening_stock:
        raise ServiceError("Add the option first, then receive stock for it.", code="stock_per_variant")
    product = catalog.get_product(db, product_id)
    catalog.add_variant(db, editor, product, body.name, body.swatch_hex, context)
    db.commit()
    return _one(db, product, editor)


@router.patch("/products/{product_id}/variants/{variant_id}", response_model=StaffProductOut, **HIDE_UNSET)
def update_variant(
    product_id: uuid.UUID, variant_id: uuid.UUID, body: VariantPatch, db: DB, editor: Editor, context: Context
) -> StaffProductOut:
    product = catalog.get_product(db, product_id)
    variant = catalog.get_variant(product, variant_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("name", "") is None:
        raise ServiceError("Option name can't be empty.", code="required")
    catalog.update_variant(db, editor, product, variant, changes, context)
    db.commit()
    return _one(db, product, editor)


@router.delete("/products/{product_id}/variants/{variant_id}", response_model=StaffProductOut, **HIDE_UNSET)
def remove_variant(
    product_id: uuid.UUID, variant_id: uuid.UUID, db: DB, editor: Editor, context: Context
) -> StaffProductOut:
    product = catalog.get_product(db, product_id)
    catalog.remove_variant(db, editor, product, catalog.get_variant(product, variant_id), context)
    db.commit()
    return _one(db, product, editor)


# Photos


@router.post("/products/{product_id}/images", response_model=StaffProductOut, status_code=201, **HIDE_UNSET)
def add_photo(
    product_id: uuid.UUID,
    db: DB,
    editor: Editor,
    context: Context,
    storage: Storage,
    file: Annotated[UploadFile, File(description="JPG or PNG, 5 MB or smaller")],
) -> StaffProductOut:
    # Read one byte past the limit so an oversized file is refused without reading all of it.
    data = file.file.read(get_settings().max_image_bytes + 1)
    product = catalog.get_product(db, product_id)
    catalog.add_photo(db, editor, product, data, storage, context)
    db.commit()
    return _one(db, product, editor)


@router.delete("/products/{product_id}/images/{image_id}", response_model=StaffProductOut, **HIDE_UNSET)
def remove_photo(
    product_id: uuid.UUID, image_id: uuid.UUID, db: DB, editor: Editor, context: Context, storage: Storage
) -> StaffProductOut:
    product = catalog.get_product(db, product_id)
    url = catalog.remove_photo(db, editor, product, image_id, storage, context)
    db.commit()
    storage.delete_url(url)  # only once the database change is saved
    return _one(db, product, editor)


@router.put("/products/{product_id}/images/order", response_model=StaffProductOut, **HIDE_UNSET)
def reorder_photos(
    product_id: uuid.UUID, body: PhotoOrderIn, db: DB, editor: Editor, context: Context
) -> StaffProductOut:
    product = catalog.get_product(db, product_id)
    catalog.reorder_photos(db, editor, product, body.image_ids, context)
    db.commit()
    return _one(db, product, editor)


# Stock


def _product_and_variant(db: DB, product_id: uuid.UUID, variant_id: uuid.UUID | None):
    product = catalog.get_product(db, product_id)
    return product, catalog.get_variant(product, variant_id)


@router.post("/stock/receive", response_model=StaffProductOut, **HIDE_UNSET)
def receive_stock(body: ReceiveIn, db: DB, manager: StockManager, context: Context) -> StaffProductOut:
    product, variant = _product_and_variant(db, body.product_id, body.variant_id)
    stock.receive(
        db, manager, product, body.qty, variant=variant,
        supplier=(body.supplier or "").strip() or None, unit_cost_rwf=body.unit_cost_rwf,
        note=(body.note or "").strip() or None, context=context,
    )
    db.commit()
    return _one(db, product, manager)


@router.post("/stock/adjust", response_model=StaffProductOut, **HIDE_UNSET)
def adjust_stock(body: AdjustIn, db: DB, manager: StockManager, context: Context) -> StaffProductOut:
    product, variant = _product_and_variant(db, body.product_id, body.variant_id)
    stock.adjust(db, manager, product, body.change_qty, body.reason, variant=variant, note=body.note, context=context)
    db.commit()
    return _one(db, product, manager)


@router.get("/stock/movements", response_model=MovementPage, **HIDE_UNSET)
def list_movements(
    db: DB,
    viewer: Viewer,
    product_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> MovementPage:
    query = (
        select(StockMovement, Product.name, Product.sku, ProductVariant.name, Staff.name, Order.number)
        .join(Product, Product.id == StockMovement.product_id)
        .outerjoin(ProductVariant, ProductVariant.id == StockMovement.variant_id)
        .outerjoin(Staff, Staff.id == StockMovement.staff_id)
        .outerjoin(Order, Order.id == StockMovement.order_id)
    )
    if product_id is not None:
        query = query.where(StockMovement.product_id == product_id)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.execute(
        query.order_by(StockMovement.created_at.desc(), StockMovement.id).offset((page - 1) * page_size).limit(page_size)
    ).all()

    sees_cost = _sees_cost(viewer)
    items = []
    for movement, product_name, sku, variant_name, staff_name, order_number in rows:
        data = dict(
            id=movement.id, at=movement.created_at, product_id=movement.product_id,
            product_name=product_name, sku=sku, variant_name=variant_name,
            change_qty=movement.change_qty, reason=movement.reason, supplier=movement.supplier,
            note=movement.note, order_number=order_number,
            by=staff_name or ("Online" if order_number else "System"),
        )
        if sees_cost:
            data["unit_cost_rwf"] = movement.unit_cost_rwf
        items.append(MovementOut(**data))
    return MovementPage(items=items, total=total or 0, page=page, page_size=page_size)


# Categories


def _get_category(db: DB, category_id: uuid.UUID) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise NotFound("That category doesn't exist.", code="category_not_found")
    return category


def _categories_out(db: DB) -> list[StaffCategoryOut]:
    counts = catalog.product_counts(db)
    return [
        StaffCategoryOut(**CategoryOut.model_validate(c).model_dump(), product_count=counts.get(c.id, 0))
        for c in catalog.list_categories(db)
    ]


@router.get("/categories", response_model=list[StaffCategoryOut])
def list_categories(db: DB, viewer: Viewer) -> list[StaffCategoryOut]:
    return _categories_out(db)


@router.post("/categories", response_model=list[StaffCategoryOut], status_code=201)
def create_category(body: CategoryIn, db: DB, editor: Editor, context: Context) -> list[StaffCategoryOut]:
    catalog.create_category(db, editor, body.name, body.tint, context)
    db.commit()
    return _categories_out(db)


@router.patch("/categories/{category_id}", response_model=list[StaffCategoryOut])
def update_category(
    category_id: uuid.UUID, body: CategoryPatch, db: DB, editor: Editor, context: Context
) -> list[StaffCategoryOut]:
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    catalog.update_category(db, editor, _get_category(db, category_id), changes, context)
    db.commit()
    return _categories_out(db)


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: uuid.UUID, db: DB, editor: Editor, context: Context) -> Response:
    catalog.delete_category(db, editor, _get_category(db, category_id), context)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
