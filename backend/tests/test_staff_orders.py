"""Stage 4: staff orders, walk-in sales, payment checks, cancelling, WhatsApp links and the dashboard."""

from datetime import timedelta
from urllib.parse import unquote

import pytest
from sqlalchemy import select

from app.models import ActivityLog, Order, Product, StockMovement
from app.services import shop_settings
from tests.test_catalog import find_keys, last_log, product_id
from tests.test_shop import PHONE, place, stock_of

ORDERS = "/api/v1/staff/orders"


def online_order(client, db, payment_method="momo", items=None) -> dict:
    items = items or [{"product_id": product_id(db, "SCH-001"), "qty": 2}, {"product_id": product_id(db, "PHN-001"), "qty": 1}]
    response = place(client, db, items, payment_method=payment_method)
    assert response.status_code == 201, response.text
    return response.json()


def staff_id_of(client, db, number, headers) -> str:
    return client.get(ORDERS, params={"q": number}, headers=headers).json()["items"][0]["id"]


def send_txn(client, number, txn="MP123456789"):
    response = client.post(f"/api/v1/orders/{number}/payment", json={"phone": PHONE, "method": "momo", "transaction_id": txn})
    assert response.status_code == 200, response.text


def advance(client, oid, headers, **body):
    return client.post(f"{ORDERS}/{oid}/status", json=body, headers=headers)


def pick_all(client, oid, headers):
    for item in client.get(f"{ORDERS}/{oid}", headers=headers).json()["line_items"]:
        client.patch(f"{ORDERS}/{oid}/items/{item['id']}", json={"picked": True}, headers=headers)


# Listing


def test_list_search_and_counts(client, seeded, headers):
    order = online_order(client, seeded)

    page = client.get(ORDERS, headers=headers["worker"]).json()
    by_phone = client.get(ORDERS, params={"q": "0788 123 456"}, headers=headers["worker"]).json()
    by_name = client.get(ORDERS, params={"q": "aline"}, headers=headers["worker"]).json()

    row = page["items"][0]
    assert (row["number"], row["customer"], row["items"], row["status"]) == (order["number"], "Aline Uwase", 3, "new")
    assert row["payment"] == "MoMo · not paid yet"
    assert page["counts"]["new"] == 1
    assert by_phone["total"] == by_name["total"] == 1


def test_order_detail_has_items_with_shelf_and_history(client, seeded, headers):
    order = online_order(client, seeded)
    send_txn(client, order["number"])
    oid = staff_id_of(client, seeded, order["number"], headers["worker"])

    detail = client.get(f"{ORDERS}/{oid}", headers=headers["worker"]).json()

    assert detail["payment"] == "MoMo · to verify" and detail["transaction_id"] == "MP123456789"
    assert {(i["name"], i["location"]) for i in detail["line_items"]} == {
        ("A4 spiral notebook, 200 pages", "Shelf A2"), ("USB-C fast charger", "Wall rack")
    }
    assert [(h["status"], h["event"], h["who"]) for h in detail["history"]] == [
        ("new", None, "Customer (online)"), ("new", "payment_sent", "Customer (online)")
    ]
    assert find_keys(detail, {"cost_rwf", "unit_cost_rwf"}) == set()


# Status changes


def test_order_moves_forward_one_step_and_ready_needs_picking(client, seeded, headers, team):
    oid = staff_id_of(client, seeded, online_order(client, seeded, "pay_at_pickup")["number"], headers["worker"])

    assert advance(client, oid, headers["worker"]).json()["status"] == "preparing"
    blocked = advance(client, oid, headers["worker"])
    assert blocked.json()["code"] == "items_not_picked"
    pick_all(client, oid, headers["worker"])
    ready = advance(client, oid, headers["worker"]).json()

    assert ready["status"] == "ready"
    assert [h["who"] for h in ready["history"] if h["event"] is None][1:] == [team["worker"].name, team["worker"].name]
    assert last_log(seeded, "order.status_changed").after["status"] == "ready"


def test_collecting_pay_at_pickup_records_how_they_paid(client, seeded, headers):
    oid = staff_id_of(client, seeded, online_order(client, seeded, "pay_at_pickup")["number"], headers["worker"])
    advance(client, oid, headers["worker"])
    pick_all(client, oid, headers["worker"])
    advance(client, oid, headers["worker"])

    missing = advance(client, oid, headers["worker"])
    collected = advance(client, oid, headers["worker"], paid_with="cash").json()

    assert missing.json()["code"] == "paid_with_required"
    assert (collected["status"], collected["payment_status"], collected["paid_with"]) == ("collected", "paid", "cash")
    assert collected["payment"] == "Paid at pickup · Cash"
    assert advance(client, oid, headers["worker"]).json()["code"] == "final_status"


def test_unpaid_momo_order_cannot_be_collected(client, seeded, headers):
    oid = staff_id_of(client, seeded, online_order(client, seeded)["number"], headers["worker"])
    advance(client, oid, headers["worker"])
    pick_all(client, oid, headers["worker"])
    advance(client, oid, headers["worker"])

    response = advance(client, oid, headers["worker"], paid_with="cash")

    assert response.json()["code"] == "not_paid"


def test_items_cannot_be_unticked_once_ready(client, seeded, headers):
    oid = staff_id_of(client, seeded, online_order(client, seeded, "pay_at_pickup")["number"], headers["worker"])
    pick_all(client, oid, headers["worker"])
    advance(client, oid, headers["worker"])
    advance(client, oid, headers["worker"])
    item = client.get(f"{ORDERS}/{oid}", headers=headers["worker"]).json()["line_items"][0]

    response = client.patch(f"{ORDERS}/{oid}/items/{item['id']}", json={"picked": False}, headers=headers["worker"])

    assert response.json()["code"] == "not_preparing"


# Payments


def test_verify_payment_is_sensitive_and_records_who(client, seeded, headers, team):
    order = online_order(client, seeded)
    send_txn(client, order["number"])
    oid = staff_id_of(client, seeded, order["number"], headers["worker"])

    verified = client.post(f"{ORDERS}/{oid}/verify-payment", json={"found": True}, headers=headers["worker"]).json()

    assert verified["payment_status"] == "paid" and verified["verified_by"] == team["worker"].name
    assert verified["payment"] == f"Paid · MoMo, verified by {team['worker'].name}"
    entry = last_log(seeded, "order.payment_verified")
    assert entry.is_sensitive and entry.before["momo_txn_id"] == "MP123456789"


def test_rejected_payment_keeps_order_and_frees_the_id(client, seeded, headers):
    order = online_order(client, seeded)
    send_txn(client, order["number"], "BADID999")
    oid = staff_id_of(client, seeded, order["number"], headers["worker"])

    rejected = client.post(f"{ORDERS}/{oid}/verify-payment", json={"found": False}, headers=headers["worker"]).json()

    assert (rejected["status"], rejected["payment_status"], rejected["transaction_id"]) == ("new", "rejected", None)
    assert rejected["history"][-1]["event"] == "payment_rejected" and rejected["history"][-1]["note"] == "BADID999"
    assert last_log(seeded, "order.payment_rejected").is_sensitive
    # The customer can send a new ID, and it goes back to the staff to check.
    send_txn(client, order["number"], "GOODID123")
    assert client.get(f"{ORDERS}/{oid}", headers=headers["worker"]).json()["payment_status"] == "awaiting_verification"


def test_nothing_to_verify(client, seeded, headers):
    oid = staff_id_of(client, seeded, online_order(client, seeded)["number"], headers["worker"])

    response = client.post(f"{ORDERS}/{oid}/verify-payment", json={"found": True}, headers=headers["worker"])

    assert response.json()["code"] == "nothing_to_verify"


# Cancelling


def test_cancel_puts_stock_back_and_is_sensitive(client, seeded, headers):
    oid = staff_id_of(client, seeded, online_order(client, seeded, "pay_at_pickup")["number"], headers["manager"])
    assert stock_of(seeded, "SCH-001") == 62

    cancelled = client.post(f"{ORDERS}/{oid}/cancel", json={"reason": "Customer changed their mind"},
                            headers=headers["manager"]).json()

    assert cancelled["status"] == "cancelled" and cancelled["cancel_reason"] == "Customer changed their mind"
    assert stock_of(seeded, "SCH-001") == 64 and stock_of(seeded, "PHN-001") == 18
    moves = seeded.scalars(select(StockMovement).where(StockMovement.reason == "returned")).all()
    assert len(moves) == 2 and all(m.note.endswith("cancelled") for m in moves)
    entry = last_log(seeded, "order.cancelled")
    assert entry.is_sensitive and entry.after["reason"] == "Customer changed their mind"


def test_workers_cannot_cancel(client, seeded, headers):
    oid = staff_id_of(client, seeded, online_order(client, seeded)["number"], headers["worker"])

    assert client.post(f"{ORDERS}/{oid}/cancel", json={"reason": "x"}, headers=headers["worker"]).status_code == 403


def test_paid_order_needs_refund_confirmation(client, seeded, headers):
    order = online_order(client, seeded)
    send_txn(client, order["number"])
    oid = staff_id_of(client, seeded, order["number"], headers["manager"])
    client.post(f"{ORDERS}/{oid}/verify-payment", json={"found": True}, headers=headers["manager"])

    unconfirmed = client.post(f"{ORDERS}/{oid}/cancel", json={"reason": "Out of stock"}, headers=headers["manager"])
    confirmed = client.post(f"{ORDERS}/{oid}/cancel", json={"reason": "Out of stock", "refund_confirmed": True},
                            headers=headers["manager"]).json()

    assert unconfirmed.json()["code"] == "refund_required"
    assert confirmed["payment_status"] == "refunded" and confirmed["payment"] == "Refunded"
    assert last_log(seeded, "order.refunded").after == {"amount_rwf": 13000}


def test_collected_orders_cannot_be_cancelled(client, seeded, headers):
    sale = client.post(ORDERS, json={"items": [{"product_id": product_id(seeded, "SCH-002"), "qty": 1}], "paid_with": "cash"},
                       headers=headers["owner"]).json()

    response = client.post(f"{ORDERS}/{sale['id']}/cancel", json={"reason": "x"}, headers=headers["owner"])

    assert response.json()["code"] == "not_cancellable"


# Expired


def test_unpaid_orders_expire_after_the_hold_days(client, seeded, headers):
    number = online_order(client, seeded, "pay_at_pickup")["number"]
    order = seeded.scalar(select(Order).where(Order.number == number))
    order.pickup_day = shop_settings.today_in_kigali() - timedelta(days=4)  # held 3 days
    seeded.flush()

    expired = client.get(ORDERS, params={"status": "expired"}, headers=headers["worker"]).json()

    assert [o["number"] for o in expired["items"]] == [number]
    assert expired["items"][0]["expired"] is True and expired["counts"]["expired"] == 1
    assert seeded.scalar(select(Order.status).where(Order.number == number)) == "new"  # never cancelled automatically


# Walk-in sales


def test_walk_in_sale_is_paid_collected_and_reduces_stock(client, seeded, headers, team):
    seeded.get(Product, product_id(seeded, "OFF-002")).is_visible = False  # hidden online, still on the shelf
    seeded.flush()

    response = client.post(ORDERS, headers=headers["worker"], json={
        "items": [{"product_id": product_id(seeded, "SCH-002"), "qty": 2}, {"product_id": product_id(seeded, "OFF-002"), "qty": 1}],
        "paid_with": "mobile_money",
    })

    assert response.status_code == 201, response.text
    sale = response.json()
    assert (sale["source"], sale["status"], sale["payment_status"], sale["customer"]) == ("walk_in", "collected", "paid", "Walk-in")
    assert sale["total_rwf"] == 2 * 3000 + 2800 and sale["created_by"] == team["worker"].name
    assert stock_of(seeded, "SCH-002") == 50
    move = seeded.scalar(select(StockMovement).where(StockMovement.reason == "sold", StockMovement.change_qty == -2))
    assert move.staff_id == team["worker"].id
    assert last_log(seeded, "order.created").after["source"] == "walk_in"


def test_walk_in_cannot_oversell(client, seeded, headers):
    response = client.post(ORDERS, headers=headers["worker"], json={
        "items": [{"product_id": product_id(seeded, "OFF-003"), "qty": 3}], "paid_with": "cash",
    })

    assert response.status_code == 409
    assert response.json()["detail"] == "Heavy-duty stapler: Only 2 left."


# WhatsApp and receipts


def test_whatsapp_ready_link_uses_template_and_is_recorded(client, seeded, headers, team):
    oid = staff_id_of(client, seeded, online_order(client, seeded)["number"], headers["worker"])

    message = client.post(f"{ORDERS}/{oid}/whatsapp-link", json={"template": "ready"}, headers=headers["worker"]).json()

    assert message["url"].startswith("https://wa.me/250788123456?text=")
    assert unquote(message["url"].split("text=")[1]).startswith("Hello Aline Uwase, your Pahyems order PH-")
    last = client.get(f"{ORDERS}/{oid}", headers=headers["worker"]).json()["history"][-1]
    assert (last["event"], last["note"], last["who"]) == ("whatsapp_opened", "ready", team["worker"].name)


def test_walk_in_receipt_without_phone(client, seeded, headers):
    sale = client.post(ORDERS, headers=headers["worker"], json={
        "items": [{"product_id": product_id(seeded, "SCH-002"), "qty": 1}], "paid_with": "cash",
    }).json()

    message = client.post(f"{ORDERS}/{sale['id']}/whatsapp-link", json={"template": "receipt"}, headers=headers["worker"]).json()
    receipt = client.get(f"{ORDERS}/{sale['id']}/receipt", headers=headers["worker"]).json()

    assert message["url"].startswith("https://wa.me/?text=")  # staff choose the chat
    assert "1 × Ballpoint pens, pack of 10" in message["text"] and "Thank you for shopping with us!" in message["text"]
    assert receipt["total_rwf"] == 3000 and receipt["payment"] == "Cash" and receipt["show_tin"] is True


# Dashboard


@pytest.mark.parametrize("role, sections", [
    ("owner", {"kpis", "sales_7d", "low_stock", "queue", "activity", "on_shift", "pocket"}),
    ("manager", {"kpis", "restock", "moves", "queue"}),
    ("worker", {"kpis", "queue"}),
])
def test_dashboard_sections_follow_the_role(client, seeded, headers, role, sections):
    online_order(client, seeded)

    board = client.get("/api/v1/staff/dashboard", headers=headers[role]).json()

    assert set(board) - {"role", "today"} == sections
    assert find_keys(board, {"cost_rwf", "unit_cost_rwf"}) == set()


def test_owner_sales_today_excludes_cancelled(client, seeded, headers, team):
    online_order(client, seeded, "pay_at_pickup")  # 13,000
    cancelled = online_order(client, seeded, "pay_at_pickup", items=[{"product_id": product_id(seeded, "SCH-002"), "qty": 1}])
    oid = staff_id_of(client, seeded, cancelled["number"], headers["owner"])
    client.post(f"{ORDERS}/{oid}/cancel", json={"reason": "test"}, headers=headers["owner"])

    board = client.get("/api/v1/staff/dashboard", headers=headers["owner"]).json()

    assert board["kpis"]["sales_today_rwf"] == 13000 and board["kpis"]["orders_today"] == 1
    assert board["sales_7d"][-1]["total_rwf"] == 13000 and len(board["sales_7d"]) == 7
    # Signing in counts as being on shift; the owner isn't listed.
    assert {s["name"] for s in board["on_shift"]} == {team["manager"].name, team["worker"].name}
    assert any(a["action"] == "order.cancelled" for a in board["activity"])


def test_worker_dashboard_counts(client, seeded, headers):
    oid = staff_id_of(client, seeded, online_order(client, seeded)["number"], headers["worker"])
    online_order(client, seeded, items=[{"product_id": product_id(seeded, "SCH-002"), "qty": 1}])
    advance(client, oid, headers["worker"])

    board = client.get("/api/v1/staff/dashboard", headers=headers["worker"]).json()

    assert board["kpis"] == {"to_prepare": 2, "ready": 0, "requests_to_quote": 0}
    assert [q["status"] for q in board["queue"]] == ["preparing", "new"]  # oldest first


def test_activity_log_has_no_entries_from_customers(client, seeded):
    online_order(client, seeded)

    assert seeded.scalar(select(ActivityLog.id).limit(1)) is None
