"""Stage 5: customer accounts (C1), the server-side bag, and signed-in checkout."""

from datetime import timedelta

from sqlalchemy import select

from app.models import Order
from app.services import shop_settings
from tests.conftest import bearer
from tests.test_catalog import product_id
from tests.test_print_requests import form, send, staff_id
from tests.test_shop import order_body, stock_of

EMAIL = "aline@example.com"


def customer(client, notifier, email=EMAIL, name="Aline Uwase") -> dict:
    client.post("/api/v1/auth/signup", json={"name": name, "phone": "0788 123 456", "email": email, "password": "notebook-2026"})
    token = client.post("/api/v1/auth/verify", json={"email": email, "code": notifier.last_code(email)}).json()["access_token"]
    return bearer(token)


def test_resend_code_only_for_unverified(client, seeded, notifier):
    client.post("/api/v1/auth/signup", json={"name": "Aline", "phone": "0788123456", "email": EMAIL, "password": "notebook-2026"})
    first = notifier.last_code(EMAIL)

    client.post("/api/v1/auth/verify/resend", json={"email": EMAIL})
    second = notifier.last_code(EMAIL)
    assert len(notifier.sent) == 2
    if first != second:
        assert client.post("/api/v1/auth/verify", json={"email": EMAIL, "code": first}).status_code == 400
    assert client.post("/api/v1/auth/verify", json={"email": EMAIL, "code": second}).status_code == 200

    client.post("/api/v1/auth/verify/resend", json={"email": EMAIL})
    assert len(notifier.sent) == 2  # already verified: nothing sent, same answer


def test_signed_in_checkout_links_order_and_empties_server_bag(client, seeded, notifier):
    h = customer(client, notifier)
    pid = product_id(seeded, "SCH-001")
    client.put("/api/v1/cart", json={"items": [{"product_id": pid, "qty": 2}]}, headers=h)

    placed = client.post("/api/v1/orders", json=order_body(seeded, [{"product_id": pid, "qty": 2}]), headers=h)

    assert placed.status_code == 201
    order = seeded.scalar(select(Order).where(Order.number == placed.json()["number"]))
    assert order.customer_id is not None
    assert client.get("/api/v1/cart", headers=h).json()["lines"] == []
    mine = client.get("/api/v1/me/orders", headers=h).json()["items"]
    assert [o["number"] for o in mine] == [order.number] and mine[0]["items"] == "A4 spiral notebook, 200 pages × 2"


def test_customers_only_see_their_own_orders(client, seeded, notifier):
    aline = customer(client, notifier)
    number = client.post("/api/v1/orders", json=order_body(seeded, [{"product_id": product_id(seeded, "SCH-002"), "qty": 1}]),
                         headers=aline).json()["number"]
    oid = str(seeded.scalar(select(Order.id).where(Order.number == number)))
    other = customer(client, notifier, email="other@example.com", name="Other Person")

    assert client.get("/api/v1/me/orders", headers=other).json()["items"] == []
    assert client.get(f"/api/v1/me/orders/{oid}", headers=other).status_code == 404
    assert client.post(f"/api/v1/me/orders/{oid}/cancel", headers=other).status_code == 404
    assert client.get("/api/v1/me/orders").status_code == 401


def test_my_orders_are_paged_newest_first(client, seeded, notifier):
    h = customer(client, notifier)
    pid = product_id(seeded, "SCH-002")
    numbers = [client.post("/api/v1/orders", json=order_body(seeded, [{"product_id": pid, "qty": 1}]), headers=h).json()["number"]
               for _ in range(3)]

    first = client.get("/api/v1/me/orders?page_size=2", headers=h).json()
    second = client.get("/api/v1/me/orders?page_size=2&page=2", headers=h).json()

    assert first["total"] == 3 and [o["number"] for o in first["items"]] == numbers[:0:-1]
    assert [o["number"] for o in second["items"]] == numbers[:1]
    assert client.get("/api/v1/me/orders?page_size=51", headers=h).status_code == 422
    # The overview still finds the newest open order, whatever page it is on.
    assert client.get("/api/v1/me/overview", headers=h).json()["current_order"]["number"] == numbers[-1]


def test_customer_can_cancel_only_new_unpaid_orders(client, seeded, notifier, headers):
    h = customer(client, notifier)
    pid = product_id(seeded, "SCH-001")
    first = client.post("/api/v1/orders", json=order_body(seeded, [{"product_id": pid, "qty": 2}], payment_method="pay_at_pickup"),
                        headers=h).json()["number"]
    second = client.post("/api/v1/orders", json=order_body(seeded, [{"product_id": pid, "qty": 1}]), headers=h).json()["number"]
    client.post(f"/api/v1/orders/{second}/payment", json={"phone": "0788123456", "method": "momo", "transaction_id": "ABC12345"})
    ids = {n: str(seeded.scalar(select(Order.id).where(Order.number == n))) for n in (first, second)}

    rows = {o["number"]: o["can_cancel"] for o in client.get("/api/v1/me/orders", headers=h).json()["items"]}
    assert rows == {first: True, second: False}
    assert client.post(f"/api/v1/me/orders/{ids[second]}/cancel", headers=h).json()["code"] == "call_to_cancel"
    cancelled = client.post(f"/api/v1/me/orders/{ids[first]}/cancel", headers=h).json()
    assert cancelled["status"] == "cancelled" and stock_of(seeded, "SCH-001") == 63  # 64 - 2 - 1 + 2
    detail = client.get(f"/api/v1/staff/orders/{ids[first]}", headers=headers["worker"]).json()
    assert detail["history"][-1]["note"] == "Cancelled by the customer"


def test_reorder_adds_to_bag_at_todays_price(client, seeded, notifier, headers):
    h = customer(client, notifier)
    pid = product_id(seeded, "SCH-002")
    number = client.post("/api/v1/orders", json=order_body(seeded, [{"product_id": pid, "qty": 2}]), headers=h).json()["number"]
    oid = str(seeded.scalar(select(Order.id).where(Order.number == number)))
    client.patch(f"/api/v1/staff/products/{pid}", json={"price_rwf": 3500}, headers=headers["manager"])

    bag = client.post(f"/api/v1/me/orders/{oid}/reorder", headers=h).json()

    assert [(l["name"], l["qty"], l["unit_price_rwf"]) for l in bag["lines"]] == [("Ballpoint pens, pack of 10", 2, 3500)]


def test_cart_put_merges_duplicates_and_drops_unknown(client, seeded, notifier):
    h = customer(client, notifier)
    pid = product_id(seeded, "SCH-001")

    bag = client.put("/api/v1/cart", headers=h, json={"items": [
        {"product_id": pid, "qty": 1}, {"product_id": pid, "qty": 2},
        {"product_id": "00000000-0000-0000-0000-000000000000", "qty": 1},
    ]}).json()

    assert [(l["name"], l["qty"]) for l in bag["lines"]] == [("A4 spiral notebook, 200 pages", 3)]


def test_profile_and_whatsapp_preference_reach_staff(client, seeded, notifier, headers):
    h = customer(client, notifier)
    updated = client.patch("/api/v1/me", json={"name": "Aline U.", "whatsapp_updates": False}, headers=h).json()
    number = client.post("/api/v1/orders", json=order_body(seeded, [{"product_id": product_id(seeded, "SCH-002"), "qty": 1}]),
                         headers=h).json()["number"]
    oid = str(seeded.scalar(select(Order.id).where(Order.number == number)))

    assert updated["name"] == "Aline U." and updated["whatsapp_updates"] is False
    assert client.patch("/api/v1/me", json={"email": "new@example.com"}, headers=h).status_code == 422
    assert client.get(f"/api/v1/staff/orders/{oid}", headers=headers["worker"]).json()["prefers_call"] is True


def test_password_change_keeps_this_device_only(client, seeded, notifier):
    h = customer(client, notifier)
    other_device = client.post("/api/v1/auth/login", json={"email": EMAIL, "password": "notebook-2026"}).json()["access_token"]

    wrong = client.post("/api/v1/me/password", json={"current_password": "nope-nope", "new_password": "fresh-pass-1"}, headers=h)
    ok = client.post("/api/v1/me/password", json={"current_password": "notebook-2026", "new_password": "fresh-pass-1"}, headers=h)

    assert wrong.json()["code"] == "wrong_password" and ok.status_code == 200
    assert client.get("/api/v1/me", headers=h).status_code == 200
    assert client.get("/api/v1/me", headers=bearer(other_device)).status_code == 401


def test_customer_request_shows_on_account_and_quote_can_be_accepted(client, seeded, notifier, headers):
    h = customer(client, notifier)
    number = send(client, headers=h).json()["number"]
    rid = staff_id(client, number, headers["worker"])
    day = (shop_settings.today_in_kigali() + timedelta(days=8)).isoformat()
    client.post(f"/api/v1/staff/print-requests/{rid}/quote", json={"quote_rwf": 96000, "ready_on": day}, headers=headers["worker"])

    overview = client.get("/api/v1/me/overview", headers=h).json()
    accepted = client.post(f"/api/v1/me/print-requests/{rid}/accept-quote", headers=h).json()
    again = client.post(f"/api/v1/me/print-requests/{rid}/accept-quote", headers=h)

    assert overview["open_quote"]["number"] == number and overview["open_quote"]["quote_rwf"] == 96000
    assert accepted["status"] == "in_progress"
    assert again.json()["code"] == "nothing_to_accept"
    other = customer(client, notifier, email="other@example.com")
    assert client.post(f"/api/v1/me/print-requests/{rid}/accept-quote", headers=other).status_code == 404


def test_overview_current_order_and_buy_again(client, seeded, notifier):
    h = customer(client, notifier)
    client.post("/api/v1/orders", json=order_body(seeded, [{"product_id": product_id(seeded, "SCH-001"), "qty": 1},
                                                           {"product_id": product_id(seeded, "PHN-001"), "qty": 1}]), headers=h)

    overview = client.get("/api/v1/me/overview", headers=h).json()

    assert overview["current_order"]["status"] == "new"
    assert {b["name"] for b in overview["buy_again"]} == {"A4 spiral notebook, 200 pages", "USB-C fast charger"}
    assert all(b["available"] for b in overview["buy_again"])


def test_guest_request_form_still_works_without_login(client, seeded):
    assert send(client, data=form("binding")).status_code == 201
