"""Products, variants, photos and categories. Every change writes an activity log entry before the caller commits."""

import re
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.storage import FileStorage
from app.models import Category, OrderItem, Product, ProductImage, ProductVariant, Staff, StockMovement
from app.models.catalog import CATEGORY_TINTS
from app.services import audit, photos, stock
from app.services.context import RequestContext
from app.services.errors import Conflict, NotFound, ServiceError

# Fields a PATCH may change. Stock is not here: it changes only through stock movements.
EDITABLE_FIELDS = (
    "name", "category_id", "description", "price_rwf", "cost_rwf", "sku", "low_stock_alert", "location",
    "is_visible", "is_featured", "specs",
)


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "item"


def _unique_slug(db: Session, model, name: str, exclude_id: uuid.UUID | None = None) -> str:
    base = slugify(name)
    slug, n = base, 2
    while True:
        query = select(model.id).where(model.slug == slug)
        if exclude_id is not None:
            query = query.where(model.id != exclude_id)
        if db.scalar(query) is None:
            return slug
        slug, n = f"{base}-{n}", n + 1


def _label(product: Product) -> str:
    return f"SKU {product.sku}"


def normalize_sku(sku: str) -> str:
    sku = sku.strip().upper()
    if not sku:
        raise ServiceError("Enter a SKU or barcode.", code="sku_required")
    return sku


def snapshot(product: Product) -> dict[str, Any]:
    return {field: getattr(product, field) for field in EDITABLE_FIELDS}


# Products


@dataclass(frozen=True)
class ProductFilters:
    q: str | None = None
    category_id: uuid.UUID | None = None
    low_only: bool = False
    visible: bool | None = None


def list_products(db: Session, filters: ProductFilters, page: int, page_size: int) -> tuple[list[Product], int]:
    query = select(Product).join(Product.category)
    if filters.q:
        term = f"%{filters.q.strip()}%"
        query = query.where(or_(Product.name.ilike(term), Product.sku.ilike(term)))
    if filters.category_id:
        query = query.where(Product.category_id == filters.category_id)
    if filters.low_only:
        query = query.where(Product.stock_qty < Product.low_stock_alert)
    if filters.visible is not None:
        query = query.where(Product.is_visible.is_(filters.visible))

    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    items = db.scalars(
        query.order_by(Category.sort_order, Category.name, Product.name).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return list(items), total or 0


def get_product(db: Session, product_id: uuid.UUID) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise NotFound("That product doesn't exist.", code="product_not_found")
    return product


def get_variant(product: Product, variant_id: uuid.UUID | None) -> ProductVariant | None:
    if variant_id is None:
        return None
    for variant in product.variants:
        if variant.id == variant_id:
            return variant
    raise NotFound("That option doesn't exist on this product.", code="variant_not_found")


def _check_category(db: Session, category_id: uuid.UUID) -> None:
    if db.get(Category, category_id) is None:
        raise ServiceError("Choose a category.", code="category_not_found")


def _check_sku_free(db: Session, sku: str, exclude_id: uuid.UUID | None = None) -> None:
    query = select(Product.id).where(Product.sku == sku)
    if exclude_id is not None:
        query = query.where(Product.id != exclude_id)
    if db.scalar(query) is not None:
        raise Conflict(f"Another product already uses SKU {sku}.", code="sku_taken")


@dataclass(frozen=True)
class NewVariant:
    name: str
    swatch_hex: str | None = None
    opening_stock: int = 0


def create_product(
    db: Session,
    actor: Staff,
    *,
    name: str,
    category_id: uuid.UUID,
    price_rwf: int,
    cost_rwf: int | None,
    sku: str,
    opening_stock: int,
    low_stock_alert: int,
    description: str,
    location: str | None,
    is_visible: bool,
    variants: list[NewVariant],
    context: RequestContext,
    is_featured: bool = False,
    specs: list[dict] | None = None,
) -> Product:
    sku = normalize_sku(sku)
    _check_category(db, category_id)
    _check_sku_free(db, sku)
    if variants and opening_stock:
        raise ServiceError("With options, enter opening stock for each option.", code="stock_per_variant")
    if len({v.name.strip().lower() for v in variants}) != len(variants):
        raise ServiceError("Each option needs a different name.", code="duplicate_variant")

    product = Product(
        name=name.strip(),
        slug=_unique_slug(db, Product, name),
        category_id=category_id,
        description=description.strip(),
        price_rwf=price_rwf,
        cost_rwf=cost_rwf,
        sku=sku,
        low_stock_alert=low_stock_alert,
        location=(location or "").strip() or None,
        is_visible=is_visible,
        is_featured=is_featured,
        specs=specs or [],
    )
    db.add(product)
    for i, v in enumerate(variants):
        product.variants.append(ProductVariant(name=v.name.strip(), swatch_hex=v.swatch_hex, sort_order=i))
    db.flush()

    audit.record(
        db, actor, "product.created",
        entity_type="product", entity_id=product.id, entity_label=_label(product),
        after={**snapshot(product), "variants": [v.name for v in variants]}, context=context,
    )

    # Opening stock is a delivery, so it shows in the stock movements like any other.
    note = "Opening stock"
    if opening_stock > 0:
        stock.receive(db, actor, product, opening_stock, variant=None, supplier=None,
                      unit_cost_rwf=cost_rwf, note=note, context=context)
    for variant, v in zip(product.variants, variants, strict=True):
        if v.opening_stock > 0:
            stock.receive(db, actor, product, v.opening_stock, variant=variant, supplier=None,
                          unit_cost_rwf=cost_rwf, note=note, context=context)
    return product


def update_product(
    db: Session, actor: Staff, product: Product, changes: dict[str, Any], context: RequestContext
) -> Product:
    """Applies a partial edit. A price change and a visibility change each get their own log entry,
    so the price change is flagged as sensitive on its own."""
    unknown = set(changes) - set(EDITABLE_FIELDS)
    if unknown:
        raise ServiceError(f"These can't be edited here: {', '.join(sorted(unknown))}.", code="not_editable")

    if "sku" in changes:
        changes["sku"] = normalize_sku(changes["sku"])
        _check_sku_free(db, changes["sku"], exclude_id=product.id)
    if "category_id" in changes:
        _check_category(db, changes["category_id"])
    if "name" in changes:
        changes["name"] = changes["name"].strip()
    if "location" in changes:
        changes["location"] = (changes["location"] or "").strip() or None

    changed = {k: v for k, v in changes.items() if getattr(product, k) != v}
    if not changed:
        return product
    before = {k: getattr(product, k) for k in changed}
    for key, value in changed.items():
        setattr(product, key, value)
    db.flush()
    # Changing the alert level can make a product no longer low.
    if "low_stock_alert" in changed and not product.is_low:
        stock.clear_low_stock_flag(db, product.id)

    entry = {"entity_type": "product", "entity_id": product.id, "entity_label": _label(product), "context": context}
    if "price_rwf" in changed:
        audit.record(db, actor, "product.price_changed", before={"price_rwf": before.pop("price_rwf")},
                     after={"price_rwf": changed.pop("price_rwf")}, **entry)
    if "is_visible" in changed:
        audit.record(db, actor, "product.visibility_changed", before={"is_visible": before.pop("is_visible")},
                     after={"is_visible": changed.pop("is_visible")}, **entry)
    if changed:
        audit.record(db, actor, "product.updated", before=before, after=changed, **entry)
    return product


# Variants


def add_variant(
    db: Session, actor: Staff, product: Product, name: str, swatch_hex: str | None, context: RequestContext
) -> ProductVariant:
    if not product.variants and product.stock_qty > 0:
        # The existing stock isn't split between options, so it can't be kept consistent.
        raise ServiceError(
            "This product has stock that isn't split by option. Adjust its stock to 0 before adding options.",
            code="stock_not_split",
        )
    name = name.strip()
    if any(v.name.lower() == name.lower() for v in product.variants):
        raise Conflict(f"This product already has an option called {name}.", code="duplicate_variant")
    variant = ProductVariant(name=name, swatch_hex=swatch_hex, sort_order=len(product.variants))
    product.variants.append(variant)
    db.flush()
    audit.record(db, actor, "product.variant_added", entity_type="product", entity_id=product.id,
                 entity_label=_label(product), after={"variant": name, "swatch_hex": swatch_hex}, context=context)
    return variant


def update_variant(
    db: Session, actor: Staff, product: Product, variant: ProductVariant, changes: dict[str, Any], context: RequestContext
) -> ProductVariant:
    if "name" in changes:
        changes["name"] = changes["name"].strip()
        if any(v.id != variant.id and v.name.lower() == changes["name"].lower() for v in product.variants):
            raise Conflict(f"This product already has an option called {changes['name']}.", code="duplicate_variant")
    changed = {k: v for k, v in changes.items() if getattr(variant, k) != v}
    if not changed:
        return variant
    before = {k: getattr(variant, k) for k in changed}
    for key, value in changed.items():
        setattr(variant, key, value)
    db.flush()
    audit.record(db, actor, "product.variant_updated", entity_type="product", entity_id=product.id,
                 entity_label=_label(product), before=before, after=changed, context=context)
    return variant


def remove_variant(
    db: Session, actor: Staff, product: Product, variant: ProductVariant, context: RequestContext
) -> None:
    if variant.stock_qty != 0:
        raise ServiceError("Adjust this option's stock to 0 before removing it.", code="variant_has_stock")
    used = db.scalar(select(StockMovement.id).where(StockMovement.variant_id == variant.id).limit(1)) or db.scalar(
        select(OrderItem.id).where(OrderItem.variant_id == variant.id).limit(1)
    )
    if used is not None:
        raise ServiceError("This option has stock history or orders, so it can't be removed.", code="variant_in_use")
    product.variants.remove(variant)
    db.delete(variant)
    db.flush()
    audit.record(db, actor, "product.variant_removed", entity_type="product", entity_id=product.id,
                 entity_label=_label(product), before={"variant": variant.name}, context=context)


# Photos


def add_photo(
    db: Session, actor: Staff, product: Product, data: bytes, storage: FileStorage, context: RequestContext
) -> ProductImage:
    limit = get_settings().max_product_images
    if len(product.images) >= limit:
        raise ServiceError(f"A product can have up to {limit} photos.", code="too_many_photos")
    content, extension = photos.prepare_photo(data)
    url = storage.save(f"products/{uuid.uuid4().hex}.{extension}", content)
    image = ProductImage(url=url, sort_order=max((i.sort_order for i in product.images), default=-1) + 1)
    product.images.append(image)
    db.flush()
    audit.record(db, actor, "product.image_added", entity_type="product", entity_id=product.id,
                 entity_label=_label(product), after={"url": url}, context=context)
    return image


def remove_photo(
    db: Session, actor: Staff, product: Product, image_id: uuid.UUID, storage: FileStorage, context: RequestContext
) -> str:
    """Removes the photo from the product and returns its URL. The caller deletes the file after commit."""
    image = next((i for i in product.images if i.id == image_id), None)
    if image is None:
        raise NotFound("That photo doesn't exist.", code="image_not_found")
    product.images.remove(image)
    db.flush()
    audit.record(db, actor, "product.image_removed", entity_type="product", entity_id=product.id,
                 entity_label=_label(product), before={"url": image.url}, context=context)
    return image.url


def reorder_photos(
    db: Session, actor: Staff, product: Product, image_ids: list[uuid.UUID], context: RequestContext
) -> None:
    if sorted(image_ids) != sorted(i.id for i in product.images):
        raise ServiceError("List every photo of this product once.", code="invalid_order")
    position = {image_id: n for n, image_id in enumerate(image_ids)}
    for image in product.images:
        image.sort_order = position[image.id]
    product.images.sort(key=lambda i: i.sort_order)
    db.flush()
    audit.record(db, actor, "product.updated", entity_type="product", entity_id=product.id,
                 entity_label=_label(product), after={"photo_order": [str(i) for i in image_ids]}, context=context)


# Categories


def list_categories(db: Session) -> list[Category]:
    return list(db.scalars(select(Category).order_by(Category.sort_order, Category.name)))


def product_counts(db: Session) -> dict[uuid.UUID, int]:
    return dict(db.execute(select(Product.category_id, func.count()).group_by(Product.category_id)).all())


def create_category(db: Session, actor: Staff, name: str, tint: str | None, context: RequestContext) -> Category:
    name = name.strip()
    existing = list_categories(db)
    if any(c.name.lower() == name.lower() for c in existing):
        raise Conflict(f"There is already a category called {name}.", code="duplicate_category")
    if tint is not None and tint not in CATEGORY_TINTS:
        raise ServiceError("Choose one of the four colours.", code="invalid_tint")
    category = Category(
        name=name,
        slug=_unique_slug(db, Category, name),
        sort_order=max((c.sort_order for c in existing), default=0) + 1,
        # Without a choice, the colours take turns.
        tint=tint or CATEGORY_TINTS[len(existing) % len(CATEGORY_TINTS)],
    )
    db.add(category)
    db.flush()
    audit.record(db, actor, "category.created", entity_type="category", entity_id=category.id,
                 entity_label=name, after={"name": name, "tint": category.tint}, context=context)
    return category


def update_category(
    db: Session, actor: Staff, category: Category, changes: dict[str, Any], context: RequestContext
) -> Category:
    if "name" in changes:
        changes["name"] = changes["name"].strip()
        if any(c.id != category.id and c.name.lower() == changes["name"].lower() for c in list_categories(db)):
            raise Conflict(f"There is already a category called {changes['name']}.", code="duplicate_category")
    if "tint" in changes and changes["tint"] not in CATEGORY_TINTS:
        raise ServiceError("Choose one of the four colours.", code="invalid_tint")
    changed = {k: v for k, v in changes.items() if getattr(category, k) != v}
    if not changed:
        return category
    before = {k: getattr(category, k) for k in changed}
    for key, value in changed.items():
        setattr(category, key, value)
    db.flush()
    # The slug stays the same so shop links keep working.
    audit.record(db, actor, "category.updated", entity_type="category", entity_id=category.id,
                 entity_label=category.name, before=before, after=changed, context=context)
    return category


def delete_category(db: Session, actor: Staff, category: Category, context: RequestContext) -> None:
    if db.scalar(select(Product.id).where(Product.category_id == category.id).limit(1)) is not None:
        raise ServiceError("Move this category's products to another category first.", code="category_not_empty")
    db.delete(category)
    db.flush()
    audit.record(db, actor, "category.deleted", entity_type="category", entity_id=category.id,
                 entity_label=category.name, before={"name": category.name}, context=context)


# Public shop


PUBLIC_SORTS = ("featured", "az", "za")


def availability(stock_qty: int, low_stock_alert: int) -> str:
    """The shop shows this instead of exact stock counts."""
    if stock_qty <= 0:
        return "out_of_stock"
    return "few_left" if stock_qty < low_stock_alert else "in_stock"


@dataclass(frozen=True)
class PublicFilters:
    q: str | None = None
    categories: tuple[str, ...] = ()  # slugs
    min_price: int | None = None
    max_price: int | None = None
    in_stock: bool = False
    sort: str = "featured"


def list_public_products(db: Session, filters: PublicFilters, page: int, page_size: int) -> tuple[list[Product], int]:
    query = select(Product).join(Product.category).where(Product.is_visible.is_(True))
    if filters.q:
        term = f"%{filters.q.strip()}%"
        query = query.where(or_(Product.name.ilike(term), Product.sku.ilike(term)))
    if filters.categories:
        query = query.where(Category.slug.in_(filters.categories))
    if filters.min_price is not None:
        query = query.where(Product.price_rwf >= filters.min_price)
    if filters.max_price is not None:
        query = query.where(Product.price_rwf <= filters.max_price)
    if filters.in_stock:
        query = query.where(Product.stock_qty > 0)

    order = {
        # Featured first; when few are featured, the newest fill in.
        "featured": (Product.is_featured.desc(), Product.created_at.desc(), Product.name),
        "az": (Product.name,),
        "za": (Product.name.desc(),),
    }[filters.sort]
    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    items = db.scalars(query.order_by(*order, Product.id).offset((page - 1) * page_size).limit(page_size)).all()
    return list(items), total or 0


def get_public_product(db: Session, slug: str) -> Product:
    product = db.scalar(select(Product).where(Product.slug == slug, Product.is_visible.is_(True)))
    if product is None:
        raise NotFound("We couldn't find that product.", code="product_not_found")
    return product


def related_products(db: Session, product: Product, limit: int = 4) -> list[Product]:
    """"You may also need": in-stock products from the same category, then from others."""
    base = select(Product).where(Product.is_visible.is_(True), Product.id != product.id, Product.stock_qty > 0)
    same = list(db.scalars(base.where(Product.category_id == product.category_id)
                           .order_by(Product.is_featured.desc(), Product.name).limit(limit)))
    if len(same) < limit:
        same += list(db.scalars(base.where(Product.category_id != product.category_id)
                                .order_by(Product.is_featured.desc(), Product.name).limit(limit - len(same))))
    return same


def visible_counts(db: Session) -> dict[uuid.UUID, int]:
    return dict(db.execute(
        select(Product.category_id, func.count()).where(Product.is_visible.is_(True)).group_by(Product.category_id)
    ).all())
