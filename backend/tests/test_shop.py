"""Stage 3: public catalog, bag pricing, guest orders, payment IDs and tracking."""

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models import Order, OrderStatusHistory, Product, Setting, StockMovement
from app.services import shop_settings
from tests.test_catalog import find_keys, new_product, product_id

PHONE = "0788 123 456"


def pid(db, sku):
    return product_id(db, sku)


def open_day(db) -> str:
    return shop_settings.pickup_days(db)[0].isoformat()


def order_body(db, items, **overrides) -> dict:
    return {
        "items": items,
        "name": "Aline Uwase",
        "phone": PHONE,
        "email": "aline@example.com",
        "pickup_day": open_day(db),
        "payment_method": "momo",
        **overrides,
    }


def place(client, db, items, **overrides):
    return client.post("/api/v1/orders", json=order_body(db, items, **overrides))


def stock_of(db, sku) -> int:
    product = db.scalar(select(Product).where(Product.sku == sku))
    db.refresh(product)
    return product.stock_qty


# Catalog


def test_public_catalog_hides_cost_stock_and_hidden_products(client, seeded):
    seeded.get(Product, pid(seeded, "OFF-003")).is_visible = False
    seeded.flush()

    page = client.get("/api/v1/products", params={"page_size": 48}).json()

    assert page["total"] == 10
    assert "OFF-003" not in str(page)
    assert find_keys(page, {"cost_rwf", "stock_qty", "unit_cost_rwf", "sku"}) == set()
    assert client.get("/api/v1/products/heavy-duty-stapler").status_code == 404


def test_availability_labels(client, seeded):
    items = {p["name"]: p["availability"] for p in client.get("/api/v1/products", params={"page_size": 48}).json()["items"]}

    assert items["Geometry set"] == "few_left"  # 3, alert at 10
    assert items["A4 spiral notebook, 200 pages"] == "in_stock"


def test_filters_sort_and_pages(client, seeded):
    def names(**params):
        return [p["name"] for p in client.get("/api/v1/products", params={"page_size": 48, **params}).json()["items"]]

    assert names(category=["electronics"], sort="az") == ["USB flash drive, 32 GB", "Wireless over-ear headphones"]
    assert names(category=["electronics", "phone-accessories"], sort="za")[0] == "Wireless over-ear headphones"
    assert set(names(min_price=8000, max_price=15000)) == {"USB-C fast charger", "Heavy-duty stapler", "Power bank, 10,000 mAh"}
    assert names(q="charger") == ["USB-C fast charger"]
    second = client.get("/api/v1/products", params={"page": 2}).json()
    assert second["page_size"] == 12 and len(second["items"]) == 0  # 11 products fit on one page


def test_featured_come_first(client, seeded):
    seeded.get(Product, pid(seeded, "PHN-002")).is_featured = True
    seeded.flush()

    first = client.get("/api/v1/products").json()["items"][0]

    assert first["name"] == "Power bank, 10,000 mAh"


def test_out_of_stock_filter(client, seeded, headers):
    client.post("/api/v1/staff/stock/adjust", headers=headers["manager"], json={
        "product_id": pid(seeded, "OFF-003"), "change_qty": -2, "reason": "adjusted", "note": "count",
    })

    in_stock = client.get("/api/v1/products", params={"in_stock": True, "page_size": 48}).json()

    assert "Heavy-duty stapler" not in [p["name"] for p in in_stock["items"]]


def test_product_page_has_summary_specs_options_and_related(client, seeded, headers):
    body = new_product(seeded, opening_stock=0, description="Ruled, 160 pages.\n\nGreat for students.",
                       variants=[{"name": "Butter", "swatch_hex": "#F7E7B4", "opening_stock": 3}, {"name": "Sage"}],
                       specs=[{"label": "Size", "value": "A5"}])
    client.post("/api/v1/staff/products", json=body, headers=headers["manager"])

    product = client.get("/api/v1/products/a5-hardcover-notebook").json()

    assert product["summary"] == "Ruled, 160 pages."
    assert product["specs"] == [{"label": "Size", "value": "A5"}]
    assert [(v["name"], v["availability"]) for v in product["variants"]] == [("Butter", "in_stock"), ("Sage", "out_of_stock")]
    assert len(product["related"]) == 4
    assert product["related"][0]["category"]["slug"] == "school-supplies"


def test_public_categories_count_visible_products(client, seeded):
    seeded.get(Product, pid(seeded, "OFF-003")).is_visible = False
    seeded.flush()

    counts = {c["slug"]: c["product_count"] for c in client.get("/api/v1/categories").json()}

    assert counts == {"school-supplies": 4, "office-supplies": 2, "electronics": 2, "phone-accessories": 2}


# Bag


def test_bag_quote_uses_server_prices_and_reports_problems(client, seeded):
    seeded.get(Product, pid(seeded, "OFF-001")).is_visible = False
    seeded.flush()

    bag = client.post("/api/v1/cart/quote", json={"items": [
        {"product_id": pid(seeded, "SCH-001"), "qty": 2},
        {"product_id": pid(seeded, "SCH-001"), "qty": 1},  # merged with the line above
        {"product_id": pid(seeded, "OFF-003"), "qty": 5},  # only 2
        {"product_id": pid(seeded, "OFF-001"), "qty": 1},  # hidden
    ]}).json()

    lines = {l["name"]: l for l in bag["lines"]}
    assert lines["A4 spiral notebook, 200 pages"]["qty"] == 3
    assert lines["A4 spiral notebook, 200 pages"]["line_total_rwf"] == 7500
    assert lines["Heavy-duty stapler"]["problem"] == "Only 2 left."
    assert lines["A4 copy paper, 500 sheets"]["problem_code"] == "unavailable"
    assert bag["total_rwf"] == 7500 and bag["can_checkout"] is False


# Orders


def test_guest_order_reserves_stock_and_records_history(client, seeded, notifier):
    response = place(client, seeded, [
        {"product_id": pid(seeded, "SCH-001"), "qty": 2},
        {"product_id": pid(seeded, "PHN-001"), "qty": 1},
    ])

    assert response.status_code == 201, response.text
    order = response.json()
    assert order["number"].startswith("PH-")
    assert order["total_rwf"] == 2 * 2500 + 8000
    assert order["status"] == "new" and order["payment_status"] == "unpaid"
    assert order["phone"] == "0788 123 456"
    assert order["pay"] == {"method": "momo", "label": "MTN Mobile Money", "merchant_code": "[MERCHANT CODE]",
                            "amount_rwf": 13000, "reference": order["number"]}
    assert stock_of(seeded, "SCH-001") == 62
    db_order = seeded.scalar(select(Order).where(Order.number == order["number"]))
    moves = seeded.scalars(select(StockMovement).where(StockMovement.order_id == db_order.id)).all()
    assert sorted((m.reason, m.change_qty) for m in moves) == [("sold", -2), ("sold", -1)]
    history = seeded.scalar(select(OrderStatusHistory).where(OrderStatusHistory.order_id == db_order.id))
    assert (history.from_status, history.to_status, history.staff_id) == (None, "new", None)
    assert notifier.sent[-1].to == "aline@example.com"
    assert order["number"] in notifier.sent[-1].subject
    assert "13,000 RWF" in notifier.sent[-1].body and "merchant code" in notifier.sent[-1].body


def test_prices_from_the_browser_are_ignored(client, seeded):
    response = place(client, seeded, [{"product_id": pid(seeded, "SCH-001"), "qty": 1, "unit_price_rwf": 1}])

    assert response.status_code == 422  # unknown fields are refused outright


def test_last_item_cannot_be_sold_twice(client, seeded):
    first = place(client, seeded, [{"product_id": pid(seeded, "OFF-003"), "qty": 2}])
    second = place(client, seeded, [{"product_id": pid(seeded, "OFF-003"), "qty": 1}])

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["code"] == "bag_changed"
    assert second.json()["details"][0]["problem"] == "Out of stock."
    assert stock_of(seeded, "OFF-003") == 0


def test_options_must_be_chosen_and_use_their_own_stock(client, seeded, headers):
    product = client.post("/api/v1/staff/products", headers=headers["manager"], json=new_product(
        seeded, opening_stock=0, variants=[{"name": "Butter", "opening_stock": 3}, {"name": "Sage", "opening_stock": 1}]
    )).json()
    butter = product["variants"][0]["id"]

    missing = place(client, seeded, [{"product_id": product["id"], "qty": 1}])
    ok = place(client, seeded, [{"product_id": product["id"], "variant_id": butter, "qty": 2}])

    assert missing.json()["details"][0]["code"] == "variant_required"
    assert ok.status_code == 201
    assert ok.json()["items"][0]["variant_name"] == "Butter"
    after = client.get(f"/api/v1/staff/products/{product['id']}", headers=headers["manager"]).json()
    assert after["stock_qty"] == 2
    assert {v["name"]: v["stock_qty"] for v in after["variants"]} == {"Butter": 1, "Sage": 1}


def test_pickup_day_must_be_open_and_soon(client, seeded):
    closed = next(
        d for d in (shop_settings.today_in_kigali() + timedelta(days=n) for n in range(7)) if d.weekday() == 6
    )
    far = shop_settings.today_in_kigali() + timedelta(days=30)

    for day in (closed, far):
        response = place(client, seeded, [{"product_id": pid(seeded, "SCH-001"), "qty": 1}], pickup_day=day.isoformat())
        assert response.json()["code"] == "invalid_pickup_day"


def test_disabled_payment_method_is_refused(client, seeded):
    setting = seeded.scalar(select(Setting).where(Setting.key == "payment_methods"))
    setting.value = {**setting.value, "airtel": {"enabled": False, "merchant_code": "x"}}
    seeded.flush()

    response = place(client, seeded, [{"product_id": pid(seeded, "SCH-001"), "qty": 1}], payment_method="airtel")

    assert response.json()["code"] == "method_unavailable"


def test_pay_at_pickup_has_no_payment_step(client, seeded):
    order = place(client, seeded, [{"product_id": pid(seeded, "SCH-001"), "qty": 1}], payment_method="pay_at_pickup",
                  email=None).json()

    assert order["pay"] is None and order["payment_label"] == "Pay at pickup"


# Payment IDs


def test_transaction_id_moves_order_to_awaiting_verification(client, seeded):
    number = place(client, seeded, [{"product_id": pid(seeded, "SCH-001"), "qty": 1}]).json()["number"]

    response = client.post(f"/api/v1/orders/{number}/payment",
                           json={"phone": "+250788123456", "method": "airtel", "transaction_id": " ab12 345 678 "})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["payment_status"] == "awaiting_verification"
    assert body["payment_method"] == "airtel" and body["transaction_id_sent"] is True
    assert seeded.scalar(select(Order.momo_txn_id).where(Order.number == number)) == "AB12345678"


def test_transaction_id_can_be_used_once(client, seeded):
    first = place(client, seeded, [{"product_id": pid(seeded, "SCH-001"), "qty": 1}]).json()["number"]
    second = place(client, seeded, [{"product_id": pid(seeded, "SCH-002"), "qty": 1}]).json()["number"]
    payload = {"phone": PHONE, "method": "momo", "transaction_id": "MP261021.1234.A56789"}

    assert client.post(f"/api/v1/orders/{first}/payment", json=payload).status_code == 200
    again = client.post(f"/api/v1/orders/{second}/payment", json=payload)

    assert again.status_code == 409
    assert again.json()["detail"] == "This transaction ID has already been used for another order."


def test_payment_needs_the_right_phone(client, seeded):
    number = place(client, seeded, [{"product_id": pid(seeded, "SCH-001"), "qty": 1}]).json()["number"]

    response = client.post(f"/api/v1/orders/{number}/payment",
                           json={"phone": "0788 999 999", "method": "momo", "transaction_id": "ABCD1234"})

    assert response.status_code == 404


# Tracking


def test_tracking_needs_number_and_phone(client, seeded):
    number = place(client, seeded, [{"product_id": pid(seeded, "SCH-001"), "qty": 1}]).json()["number"]

    ok = client.post("/api/v1/orders/track", json={"number": number.lower(), "phone": "0788123456"})
    wrong_phone = client.post("/api/v1/orders/track", json={"number": number, "phone": "0788 000 000"})
    wrong_number = client.post("/api/v1/orders/track", json={"number": "PH-9999", "phone": PHONE})

    assert ok.status_code == 200
    assert ok.json()["email"] is None  # only shown right after placing
    assert wrong_phone.status_code == wrong_number.status_code == 404
    assert wrong_phone.json() == wrong_number.json()


def test_tracking_is_rate_limited(client, seeded):
    for _ in range(10):
        client.post("/api/v1/orders/track", json={"number": "PH-0001", "phone": PHONE})

    assert client.post("/api/v1/orders/track", json={"number": "PH-0001", "phone": PHONE}).status_code == 429


def test_public_settings_show_payment_codes_and_pickup_days(client, seeded):
    settings = client.get("/api/v1/settings/public").json()

    assert settings["payment_methods"]["momo"] == {"enabled": True, "merchant_code": "[MERCHANT CODE]"}
    assert "tin" not in settings["shop"]
    assert settings["pickup_days"]
    assert all(shop_settings.is_open_on(seeded, date.fromisoformat(d)) for d in settings["pickup_days"])
