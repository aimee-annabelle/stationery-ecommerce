"""S4 / M4 products, variants, photos and categories."""

import io
from typing import Any

import pytest
from PIL import Image
from sqlalchemy import func, select

from app.models import ActivityLog, Category, Product, StockMovement

STAFF_PRODUCTS = "/api/v1/staff/products"


def product_id(db, sku: str) -> str:
    return str(db.scalar(select(Product.id).where(Product.sku == sku)))


def category_id(db, slug: str) -> str:
    return str(db.scalar(select(Category.id).where(Category.slug == slug)))


def find_keys(value: Any, keys: set[str]) -> set[str]:
    """Every key from `keys` that appears anywhere in a JSON value."""
    found = set()
    if isinstance(value, dict):
        found |= keys & set(value)
        for child in value.values():
            found |= find_keys(child, keys)
    elif isinstance(value, list):
        for child in value:
            found |= find_keys(child, keys)
    return found


def last_log(db, action: str) -> ActivityLog:
    return db.scalar(select(ActivityLog).where(ActivityLog.action == action).order_by(ActivityLog.at.desc()))


def new_product(db, **overrides) -> dict:
    body = {
        "name": "A5 hardcover notebook",
        "category_id": category_id(db, "school-supplies"),
        "price_rwf": 3500,
        "cost_rwf": 2200,
        "sku": "sch-010",
        "opening_stock": 20,
        "low_stock_alert": 5,
        "description": "Ruled, 160 pages.",
        "location": "Shelf A4",
        "is_visible": True,
    }
    return {**body, **overrides}


# Listing and costs


def test_list_is_filtered_and_paged(client, seeded, headers):
    everything = client.get(STAFF_PRODUCTS, headers=headers["worker"]).json()
    assert everything["total"] == 11

    low = client.get(STAFF_PRODUCTS, params={"low": True}, headers=headers["worker"]).json()
    assert {p["sku"] for p in low["items"]} == {"SCH-003", "SCH-004", "OFF-001", "OFF-003", "PHN-002"}
    assert all(p["is_low"] for p in low["items"])

    search = client.get(STAFF_PRODUCTS, params={"q": "phn-00"}, headers=headers["worker"]).json()
    assert {p["sku"] for p in search["items"]} == {"PHN-001", "PHN-002"}

    page = client.get(STAFF_PRODUCTS, params={"page": 2, "page_size": 5}, headers=headers["worker"]).json()
    assert len(page["items"]) == 5


@pytest.mark.parametrize("role, sees_cost", [("owner", True), ("manager", True), ("worker", False)])
def test_cost_prices_only_reach_managers_and_the_owner(client, seeded, headers, role, sees_cost):
    """Workers never receive cost prices: the keys are missing from every response, not just empty."""
    pid = product_id(seeded, "OFF-003")
    responses = [
        client.get(STAFF_PRODUCTS, headers=headers[role]).json(),
        client.get(f"{STAFF_PRODUCTS}/{pid}", headers=headers[role]).json(),
        client.get("/api/v1/staff/stock/movements", headers=headers[role]).json(),
        client.post(f"{STAFF_PRODUCTS}/{pid}/low-stock-flag", headers=headers[role]).json(),
    ]

    found = find_keys(responses, {"cost_rwf", "unit_cost_rwf"})

    assert found == ({"cost_rwf", "unit_cost_rwf"} if sees_cost else set())


# Creating and editing


def test_create_product_records_opening_stock_as_a_delivery(client, seeded, headers):
    response = client.post(STAFF_PRODUCTS, json=new_product(seeded), headers=headers["manager"])

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["sku"] == "SCH-010"
    assert body["slug"] == "a5-hardcover-notebook"
    assert body["stock_qty"] == 20
    movement = seeded.scalar(select(StockMovement).where(StockMovement.product_id == body["id"]))
    assert (movement.reason, movement.change_qty, movement.note) == ("received", 20, "Opening stock")
    assert last_log(seeded, "product.created").entity_label == "SKU SCH-010"


def test_duplicate_sku_is_refused(client, seeded, headers):
    response = client.post(STAFF_PRODUCTS, json=new_product(seeded, sku="off-003"), headers=headers["manager"])

    assert response.status_code == 409
    assert response.json()["code"] == "sku_taken"


def test_hidden_draft_and_same_name_get_unique_slugs(client, seeded, headers):
    first = client.post(STAFF_PRODUCTS, json=new_product(seeded, is_visible=False), headers=headers["owner"]).json()
    second = client.post(STAFF_PRODUCTS, json=new_product(seeded, sku="SCH-011"), headers=headers["owner"]).json()

    assert first["is_visible"] is False
    assert second["slug"] == "a5-hardcover-notebook-2"


def test_stock_cannot_be_set_by_editing(client, seeded, headers):
    pid = product_id(seeded, "OFF-003")

    response = client.patch(f"{STAFF_PRODUCTS}/{pid}", json={"stock_qty": 100}, headers=headers["owner"])

    assert response.status_code == 422


def test_price_change_is_logged_on_its_own_as_sensitive(client, seeded, headers):
    pid = product_id(seeded, "OFF-003")

    response = client.patch(
        f"{STAFF_PRODUCTS}/{pid}",
        json={"price_rwf": 9800, "location": "Shelf B3", "is_visible": False},
        headers=headers["manager"],
    )

    assert response.status_code == 200, response.text
    price = last_log(seeded, "product.price_changed")
    assert price.is_sensitive
    assert (price.before, price.after, price.entity_label) == ({"price_rwf": 9500}, {"price_rwf": 9800}, "SKU OFF-003")
    assert last_log(seeded, "product.visibility_changed").after == {"is_visible": False}
    other = last_log(seeded, "product.updated")
    assert other.after == {"location": "Shelf B3"} and not other.is_sensitive


def test_unchanged_edit_writes_no_log(client, seeded, headers):
    pid = product_id(seeded, "OFF-003")
    before = seeded.scalar(select(func.count()).select_from(ActivityLog))

    client.patch(f"{STAFF_PRODUCTS}/{pid}", json={"price_rwf": 9500}, headers=headers["manager"])

    assert seeded.scalar(select(func.count()).select_from(ActivityLog)) == before


def test_workers_cannot_change_products(client, seeded, headers):
    pid = product_id(seeded, "OFF-003")

    assert client.post(STAFF_PRODUCTS, json=new_product(seeded), headers=headers["worker"]).status_code == 403
    assert client.patch(f"{STAFF_PRODUCTS}/{pid}", json={"price_rwf": 1}, headers=headers["worker"]).status_code == 403


# Variants


def test_product_with_variants_keeps_stock_per_option(client, seeded, headers):
    body = new_product(
        seeded,
        opening_stock=0,
        variants=[
            {"name": "Butter", "swatch_hex": "#F7E7B4", "opening_stock": 6},
            {"name": "Sage", "swatch_hex": "#DCE8DF", "opening_stock": 4},
        ],
    )

    product = client.post(STAFF_PRODUCTS, json=body, headers=headers["manager"]).json()

    assert product["stock_qty"] == 10
    assert [(v["name"], v["stock_qty"]) for v in product["variants"]] == [("Butter", 6), ("Sage", 4)]


def test_opening_stock_must_be_per_option_when_there_are_options(client, seeded, headers):
    body = new_product(seeded, opening_stock=5, variants=[{"name": "Butter"}])

    response = client.post(STAFF_PRODUCTS, json=body, headers=headers["manager"])

    assert response.json()["code"] == "stock_per_variant"


def test_first_option_needs_stock_at_zero(client, seeded, headers):
    pid = product_id(seeded, "OFF-003")

    response = client.post(f"{STAFF_PRODUCTS}/{pid}/variants", json={"name": "Black"}, headers=headers["manager"])

    assert response.json()["code"] == "stock_not_split"


def test_option_with_history_cannot_be_removed(client, seeded, headers):
    product = client.post(
        STAFF_PRODUCTS,
        json=new_product(seeded, opening_stock=0, variants=[{"name": "Butter", "opening_stock": 2}, {"name": "Sage"}]),
        headers=headers["manager"],
    ).json()
    butter, sage = product["variants"]

    client.post("/api/v1/staff/stock/adjust", headers=headers["manager"], json={
        "product_id": product["id"], "variant_id": butter["id"], "change_qty": -2, "reason": "adjusted", "note": "count",
    })
    in_use = client.delete(f"{STAFF_PRODUCTS}/{product['id']}/variants/{butter['id']}", headers=headers["manager"])
    unused = client.delete(f"{STAFF_PRODUCTS}/{product['id']}/variants/{sage['id']}", headers=headers["manager"])

    assert in_use.json()["code"] == "variant_in_use"
    assert unused.status_code == 200
    assert [v["name"] for v in unused.json()["variants"]] == ["Butter"]


# Photos


def image_bytes(fmt: str = "JPEG", size=(2400, 1200), exif: bool = False) -> bytes:
    out = io.BytesIO()
    image = Image.new("RGB", size, "#DCE8DF")
    if exif:
        data = Image.Exif()
        data[0x8825] = {2: (1.0, 2.0, 3.0)}  # GPS info
        image.save(out, format=fmt, exif=data)
    else:
        image.save(out, format=fmt)
    return out.getvalue()


def upload(client, headers, pid, content: bytes, name="photo.jpg", mime="image/jpeg"):
    return client.post(f"{STAFF_PRODUCTS}/{pid}/images", files={"file": (name, content, mime)}, headers=headers)


def test_photo_is_shrunk_stripped_stored_and_served(client, seeded, headers, storage):
    pid = product_id(seeded, "OFF-003")

    response = upload(client, headers["manager"], pid, image_bytes(exif=True))

    assert response.status_code == 201, response.text
    url = response.json()["images"][0]["url"]
    assert url.startswith("/media/products/") and url.endswith(".jpg")
    served = client.get(url)
    assert served.status_code == 200
    stored = Image.open(io.BytesIO(served.content))
    assert max(stored.size) == 1600
    assert not stored.getexif().get_ifd(0x8825)


def test_png_stays_png(client, seeded, headers, storage):
    response = upload(client, headers["manager"], product_id(seeded, "OFF-003"), image_bytes("PNG", (300, 300)),
                      name="p.png", mime="image/png")

    assert response.json()["images"][0]["url"].endswith(".png")


@pytest.mark.parametrize(
    "content, code",
    [
        (b"%PDF-1.4 not a photo", "invalid_image"),
        (b"just text renamed to .png", "invalid_image"),
        (b"\xff" * (5 * 1024 * 1024 + 1), "file_too_large"),
    ],
)
def test_bad_uploads_are_refused(client, seeded, headers, storage, content, code):
    response = upload(client, headers["manager"], product_id(seeded, "OFF-003"), content, name="x.png", mime="image/png")

    assert response.status_code == 400
    assert response.json()["code"] == code
    assert not any(storage.root.rglob("*.*"))


def test_gif_is_refused(client, seeded, headers, storage):
    response = upload(client, headers["manager"], product_id(seeded, "OFF-003"), image_bytes("GIF", (10, 10)))

    assert response.json()["code"] == "invalid_image"


def test_photo_removal_deletes_file_and_reorder_works(client, seeded, headers, storage):
    pid = product_id(seeded, "OFF-003")
    upload(client, headers["manager"], pid, image_bytes(size=(50, 50)))
    images = upload(client, headers["manager"], pid, image_bytes(size=(60, 60))).json()["images"]
    first, second = images

    reordered = client.put(f"{STAFF_PRODUCTS}/{pid}/images/order",
                           json={"image_ids": [second["id"], first["id"]]}, headers=headers["manager"])
    assert [i["id"] for i in reordered.json()["images"]] == [second["id"], first["id"]]

    removed = client.delete(f"{STAFF_PRODUCTS}/{pid}/images/{first['id']}", headers=headers["manager"])
    assert [i["id"] for i in removed.json()["images"]] == [second["id"]]
    assert client.get(first["url"]).status_code == 404


def test_media_route_only_serves_product_photos(client, storage):
    storage.save("print-requests/secret.pdf", b"private")

    assert client.get("/media/products/..%2Fprint-requests%2Fsecret.pdf").status_code == 404
    assert client.get("/media/print-requests/secret.pdf").status_code == 404


# Categories


def test_categories_public_list_and_staff_management(client, seeded, headers):
    public = client.get("/api/v1/categories").json()
    assert [(c["name"], c["tint"]) for c in public] == [
        ("School supplies", "butter"), ("Office supplies", "lilac"), ("Electronics", "blush"), ("Phone accessories", "sage"),
    ]

    created = client.post("/api/v1/staff/categories", json={"name": "Art supplies"}, headers=headers["manager"])
    assert created.status_code == 201
    art = next(c for c in created.json() if c["name"] == "Art supplies")
    assert art["tint"] == "butter" and art["product_count"] == 0 and art["slug"] == "art-supplies"

    renamed = client.patch(f"/api/v1/staff/categories/{art['id']}", json={"name": "Art & craft"}, headers=headers["manager"])
    assert any(c["name"] == "Art & craft" and c["slug"] == "art-supplies" for c in renamed.json())

    assert client.delete(f"/api/v1/staff/categories/{art['id']}", headers=headers["manager"]).status_code == 204
    full = client.delete(f"/api/v1/staff/categories/{category_id(seeded, 'electronics')}", headers=headers["manager"])
    assert full.json()["code"] == "category_not_empty"


def test_workers_cannot_manage_categories(client, seeded, headers):
    assert client.post("/api/v1/staff/categories", json={"name": "Toys"}, headers=headers["worker"]).status_code == 403


def test_featured_and_specs_can_be_edited_and_are_logged(client, seeded, headers):
    pid = product_id(seeded, "SCH-001")

    response = client.patch(f"{STAFF_PRODUCTS}/{pid}", headers=headers["manager"], json={
        "is_featured": True, "specs": [{"label": "Size", "value": "A4"}, {"label": "Pages", "value": "200"}],
    })

    assert response.status_code == 200, response.text
    assert response.json()["is_featured"] is True
    assert response.json()["specs"][1] == {"label": "Pages", "value": "200"}
    entry = last_log(seeded, "product.updated")
    assert entry.after["is_featured"] is True and len(entry.after["specs"]) == 2
    public = client.get("/api/v1/products/a4-spiral-notebook-200-pages").json()
    assert public["specs"] == [{"label": "Size", "value": "A4"}, {"label": "Pages", "value": "200"}]
