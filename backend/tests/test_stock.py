"""Receiving, adjusting, movements and low-stock flags."""

import pytest
from sqlalchemy import func, select

from app.models import LowStockFlag, Product, StockMovement
from tests.test_catalog import last_log, new_product, product_id

RECEIVE = "/api/v1/staff/stock/receive"
ADJUST = "/api/v1/staff/stock/adjust"
MOVEMENTS = "/api/v1/staff/stock/movements"


def stock_matches_movements(db) -> bool:
    for product in db.scalars(select(Product)):
        db.refresh(product)
        moved = db.scalar(select(func.coalesce(func.sum(StockMovement.change_qty), 0))
                          .where(StockMovement.product_id == product.id))
        if product.stock_qty != moved or (product.variants and product.stock_qty != sum(v.stock_qty for v in product.variants)):
            return False
    return True


def test_receive_adds_stock_and_keeps_product_cost(client, seeded, headers):
    pid = product_id(seeded, "OFF-003")

    response = client.post(RECEIVE, headers=headers["manager"], json={
        "product_id": pid, "qty": 10, "supplier": "Kigali Office Supplies", "unit_cost_rwf": 7000,
    })

    assert response.status_code == 200, response.text
    assert response.json()["stock_qty"] == 12
    assert response.json()["cost_rwf"] == 6500
    entry = last_log(seeded, "stock.received")
    assert not entry.is_sensitive
    assert entry.after["received"] == 10 and entry.after["unit_cost_rwf"] == 7000
    assert stock_matches_movements(seeded)


def test_adjust_is_sensitive_and_needs_a_note(client, seeded, headers):
    pid = product_id(seeded, "SCH-001")

    no_note = client.post(ADJUST, headers=headers["owner"], json={
        "product_id": pid, "change_qty": -2, "reason": "damaged", "note": " ",
    })
    ok = client.post(ADJUST, headers=headers["owner"], json={
        "product_id": pid, "change_qty": -2, "reason": "damaged", "note": "Water damage",
    })

    assert no_note.json()["code"] == "note_required"
    assert ok.json()["stock_qty"] == 62
    entry = last_log(seeded, "stock.adjusted")
    assert entry.is_sensitive
    assert entry.before == {"stock_qty": 64}
    assert entry.after["reason"] == "damaged" and entry.after["note"] == "Water damage"


@pytest.mark.parametrize("change, reason", [(3, "damaged"), (-3, "returned")])
def test_adjust_direction_must_match_reason(client, seeded, headers, change, reason):
    response = client.post(ADJUST, headers=headers["manager"], json={
        "product_id": product_id(seeded, "SCH-001"), "change_qty": change, "reason": reason, "note": "x",
    })

    assert response.json()["code"] == "invalid_quantity"


def test_stock_never_goes_below_zero(client, seeded, headers):
    pid = product_id(seeded, "OFF-003")  # 2 in stock

    response = client.post(ADJUST, headers=headers["manager"], json={
        "product_id": pid, "change_qty": -3, "reason": "adjusted", "note": "count",
    })

    assert response.status_code == 400
    assert response.json()["code"] == "not_enough_stock"
    assert "only 2" in response.json()["detail"]
    assert stock_matches_movements(seeded)


def test_variant_stock_needs_a_variant_and_stays_in_sync(client, seeded, headers):
    product = client.post(
        "/api/v1/staff/products",
        json=new_product(seeded, opening_stock=0, variants=[{"name": "Butter", "opening_stock": 3}, {"name": "Sage"}]),
        headers=headers["manager"],
    ).json()
    butter, sage = product["variants"]

    missing = client.post(RECEIVE, headers=headers["manager"], json={"product_id": product["id"], "qty": 5})
    received = client.post(RECEIVE, headers=headers["manager"], json={
        "product_id": product["id"], "variant_id": sage["id"], "qty": 5,
    })
    too_many = client.post(ADJUST, headers=headers["manager"], json={
        "product_id": product["id"], "variant_id": butter["id"], "change_qty": -4, "reason": "adjusted", "note": "x",
    })

    assert missing.json()["code"] == "variant_required"
    assert received.json()["stock_qty"] == 8
    assert {v["name"]: v["stock_qty"] for v in received.json()["variants"]} == {"Butter": 3, "Sage": 5}
    assert too_many.json()["code"] == "not_enough_stock"
    assert stock_matches_movements(seeded)


def test_variant_from_another_product_is_refused(client, seeded, headers):
    product = client.post(
        "/api/v1/staff/products",
        json=new_product(seeded, opening_stock=0, variants=[{"name": "Butter"}]),
        headers=headers["manager"],
    ).json()

    response = client.post(RECEIVE, headers=headers["manager"], json={
        "product_id": product_id(seeded, "OFF-003"), "variant_id": product["variants"][0]["id"], "qty": 1,
    })

    assert response.status_code == 404


def test_workers_cannot_receive_or_adjust(client, seeded, headers):
    pid = product_id(seeded, "OFF-003")

    assert client.post(RECEIVE, headers=headers["worker"], json={"product_id": pid, "qty": 1}).status_code == 403
    assert client.post(ADJUST, headers=headers["worker"], json={
        "product_id": pid, "change_qty": 1, "reason": "returned", "note": "x",
    }).status_code == 403


def test_movements_list_newest_first_with_who(client, seeded, headers, team):
    pid = product_id(seeded, "OFF-003")
    client.post(RECEIVE, headers=headers["manager"], json={"product_id": pid, "qty": 4, "supplier": "[SUPPLIER]"})

    items = client.get(MOVEMENTS, params={"product_id": pid}, headers=headers["worker"]).json()["items"]

    assert [(m["change_qty"], m["reason"], m["by"]) for m in items] == [
        (4, "received", team["manager"].name), (2, "received", "System"),
    ]


# Low-stock flags (M4)


def test_flag_emails_managers_once_and_clears_when_restocked(client, seeded, headers, team, notifier):
    pid = product_id(seeded, "OFF-003")  # 2 in stock, alert at 5

    first = client.post(f"/api/v1/staff/products/{pid}/low-stock-flag", headers=headers["worker"]).json()
    again = client.post(f"/api/v1/staff/products/{pid}/low-stock-flag", headers=headers["worker"]).json()

    assert first["notified"] == [f"{team['manager'].name} (Manager)"]
    assert first["already_flagged"] is False
    assert [e.to for e in notifier.sent] == [team["manager"].email]
    assert "Heavy-duty stapler" in notifier.sent[0].subject
    assert again["already_flagged"] is True and again["notified"] == []
    assert len(notifier.sent) == 1
    shown = client.get(f"/api/v1/staff/products/{pid}", headers=headers["manager"]).json()["low_stock_flag"]
    assert shown["flagged_by"] == team["worker"].name

    client.post(RECEIVE, headers=headers["manager"], json={"product_id": pid, "qty": 2})  # 4: still low
    assert seeded.scalar(select(LowStockFlag.cleared_at).where(LowStockFlag.product_id == pid)) is None
    client.post(RECEIVE, headers=headers["manager"], json={"product_id": pid, "qty": 1})  # 5: not low
    assert seeded.scalar(select(LowStockFlag.cleared_at).where(LowStockFlag.product_id == pid)) is not None
    assert client.get(f"/api/v1/staff/products/{pid}", headers=headers["manager"]).json()["low_stock_flag"] is None


def test_flag_goes_to_the_owner_when_there_is_no_manager(client, seeded, headers, team, notifier):
    team["manager"].is_active = False
    seeded.flush()

    response = client.post(f"/api/v1/staff/products/{product_id(seeded, 'OFF-003')}/low-stock-flag",
                           headers=headers["worker"])

    assert response.json()["notified"] == [f"{team['owner'].name} (Owner)"]
    assert [e.to for e in notifier.sent] == [team["owner"].email]

