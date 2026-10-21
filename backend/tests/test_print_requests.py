"""Stage 5: print requests (Services page, S3, M5) and contact messages."""

import json
from datetime import timedelta
from urllib.parse import unquote

import pytest
from sqlalchemy import select

from app.models import ContactMessage, PrintRequest, PrintRequestFile
from app.services import shop_settings
from tests.test_catalog import last_log

PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
STAFF_REQUESTS = "/api/v1/staff/print-requests"


def form(kind="invitations", **overrides):
    details = {"event": "Wedding", "quantity": 200, "notes": "Gold on cream"} if kind == "invitations" else \
        {"binding": "Hardcover", "copies": 4, "pages": 120}
    data = {"type": kind, "name": "Ange Mukamana", "phone": "0788 111 222", "details": json.dumps(details),
            "needed_by": (shop_settings.today_in_kigali() + timedelta(days=20)).isoformat()}
    data.update(overrides)
    return data


def send(client, data=None, files=None, headers=None):
    return client.post("/api/v1/print-requests", data=data or form(), files=files, headers=headers or {})


def staff_id(client, number, headers):
    return next(r["id"] for r in client.get(STAFF_REQUESTS, headers=headers).json()["items"] if r["number"] == number)


# Services page


def test_guest_request_with_file_is_private(client, seeded, storage, headers):
    response = send(client, files=[("files", ("thesis.pdf", PDF, "application/pdf"))])

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["number"].startswith("PR-") and body["summary"] == "200 wedding cards" and body["phone"] == "0788 111 222"
    stored = seeded.scalar(select(PrintRequestFile))
    assert stored.url.startswith("print-requests/") and not stored.url.startswith("/media")
    # Not reachable through the public media route, only through the staff download.
    assert client.get(f"/media/{stored.url}").status_code == 404
    rid = staff_id(client, body["number"], headers["worker"])
    download = client.get(f"{STAFF_REQUESTS}/{rid}/files/{stored.id}", headers=headers["worker"])
    assert download.status_code == 200 and download.content == PDF
    assert download.headers["content-disposition"].startswith("attachment;")
    assert client.get(f"{STAFF_REQUESTS}/{rid}/files/{stored.id}").status_code == 401


@pytest.mark.parametrize("name, content, code", [
    ("cv.docx", b"PK\x03\x04 word document", "invalid_file"),
    ("fake.pdf", b"<html><script>alert(1)</script>", "invalid_file"),
    ("big.pdf", b"%PDF-" + b"0" * (20 * 1024 * 1024), "file_too_large"),
])
def test_bad_files_are_refused(client, seeded, storage, name, content, code):
    response = send(client, files=[("files", (name, content, "application/pdf"))])

    assert response.status_code == 400 and response.json()["code"] == code
    assert seeded.scalar(select(PrintRequest.id)) is None


def test_at_most_three_files(client, seeded, storage):
    files = [("files", (f"p{i}.png", PNG, "image/png")) for i in range(4)]

    assert send(client, files=files).json()["code"] == "too_many_files"


@pytest.mark.parametrize("details, code", [
    ({"event": "Party", "quantity": 10}, "event_required"),
    ({"event": "Wedding", "quantity": "lots"}, "quantity_required"),
])
def test_request_details_are_checked(client, seeded, details, code):
    assert send(client, data=form(details=json.dumps(details))).json()["code"] == code


def test_binding_summary(client, seeded):
    assert send(client, data=form("binding")).json()["summary"] == "Hardcover · 4 copies · ~120 pages"


# S3 / M5 lifecycle


def test_quote_accept_ready_collect(client, seeded, headers, team):
    number = send(client).json()["number"]
    rid = staff_id(client, number, headers["worker"])
    ready_on = (shop_settings.today_in_kigali() + timedelta(days=10)).isoformat()

    assert client.post(f"{STAFF_REQUESTS}/{rid}/status", json={}, headers=headers["worker"]).json()["code"] == "quote_required"
    quoted = client.post(f"{STAFF_REQUESTS}/{rid}/quote", json={"quote_rwf": 96000, "ready_on": ready_on},
                         headers=headers["worker"]).json()
    assert (quoted["status"], quoted["quote_rwf"]) == ("quoted", 96000)
    assert last_log(seeded, "print_request.quoted").after["quote_rwf"] == 96000

    message = client.post(f"{STAFF_REQUESTS}/{rid}/whatsapp-link", json={"template": "quote"}, headers=headers["worker"]).json()
    assert message["url"].startswith("https://wa.me/250788111222?text=")
    assert unquote(message["url"].split("text=")[1]).startswith("Hello Ange, your quote for 200 wedding cards is 96,000 RWF.")

    accepted = client.post(f"{STAFF_REQUESTS}/{rid}/status", json={}, headers=headers["worker"]).json()
    ready = client.post(f"{STAFF_REQUESTS}/{rid}/status", json={}, headers=headers["worker"]).json()
    unpaid = client.post(f"{STAFF_REQUESTS}/{rid}/status", json={}, headers=headers["worker"])
    collected = client.post(f"{STAFF_REQUESTS}/{rid}/status", json={"paid_with": "cash"}, headers=headers["worker"]).json()

    assert accepted["status"] == "in_progress" and ready["status"] == "ready"
    assert unpaid.json()["code"] == "paid_with_required"
    assert (collected["status"], collected["paid_with"]) == ("collected", "cash")
    steps = [(h["status"], h["event"], h["who"]) for h in collected["history"]]
    assert steps[0] == ("new", None, "Customer")
    assert ("in_progress", None, team["worker"].name) in steps and ("quoted", "whatsapp_opened", team["worker"].name) in steps


def test_quote_cannot_change_after_acceptance(client, seeded, headers):
    rid = staff_id(client, send(client).json()["number"], headers["worker"])
    day = (shop_settings.today_in_kigali() + timedelta(days=5)).isoformat()
    client.post(f"{STAFF_REQUESTS}/{rid}/quote", json={"quote_rwf": 50000, "ready_on": day}, headers=headers["worker"])
    client.post(f"{STAFF_REQUESTS}/{rid}/status", json={}, headers=headers["worker"])

    response = client.post(f"{STAFF_REQUESTS}/{rid}/quote", json={"quote_rwf": 40000, "ready_on": day}, headers=headers["worker"])

    assert response.json()["code"] == "already_accepted"


def test_assign_and_board_counts(client, seeded, headers, team):
    rid = staff_id(client, send(client).json()["number"], headers["owner"])

    assigned = client.patch(f"{STAFF_REQUESTS}/{rid}", json={"assigned_staff_id": str(team["worker"].id)},
                            headers=headers["owner"]).json()
    board = client.get(STAFF_REQUESTS, headers=headers["worker"]).json()

    assert assigned["assigned_to"] == team["worker"].name
    assert assigned["history"][-1]["event"] == "assigned"
    assert board["counts"] == {"new": 1} and {s["name"] for s in board["staff"]} >= {team["worker"].name}


def test_board_shows_all_open_work_and_newest_collected(client, seeded, headers):
    numbers = [send(client).json()["number"] for _ in range(4)]
    rows = {r.number: r for r in seeded.scalars(select(PrintRequest))}
    for i, number in enumerate(numbers[:3]):
        rows[number].status = "collected"
        rows[number].paid_at = rows[number].created_at + timedelta(hours=i)
    seeded.flush()

    board = client.get(f"{STAFF_REQUESTS}?collected_limit=2", headers=headers["worker"]).json()

    assert [r["number"] for r in board["items"]] == [numbers[3], numbers[2], numbers[1]]
    assert board["counts"]["collected"] == 3


def test_staff_can_add_a_phone_request(client, seeded, headers, storage):
    response = client.post(STAFF_REQUESTS, data=form("binding"), headers=headers["worker"])

    assert response.status_code == 201
    assert last_log(seeded, "print_request.created").after["summary"].startswith("Hardcover")


def test_requests_need_login_for_staff_routes(client, seeded):
    assert client.get(STAFF_REQUESTS).status_code == 401


# Contact


def test_contact_message_is_saved_and_handled(client, seeded, headers, notifier):
    sent = client.post("/api/v1/contact", json={"name": "Jean", "phone": "0788 333 444", "message": "Do you sell rulers?"})
    open_list = client.get("/api/v1/staff/contact-messages", headers=headers["worker"]).json()

    assert sent.status_code == 201
    assert [m["message"] for m in open_list] == ["Do you sell rulers?"]
    assert notifier.sent == []  # the shop email is still [SHOP EMAIL]
    handled = client.post(f"/api/v1/staff/contact-messages/{open_list[0]['id']}/handled", headers=headers["worker"])
    assert handled.status_code == 204
    assert client.get("/api/v1/staff/contact-messages", headers=headers["worker"]).json() == []
    assert seeded.scalar(select(ContactMessage.handled_by_staff_id)) is not None
