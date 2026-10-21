"""Development seed data: the sample categories, products and staff from the design canvas, plus default settings.

    docker compose exec api python -m app.seed

Safe to run again: it only adds rows that are missing and never overwrites settings or passwords.
Anything in [SQUARE BRACKETS] is a placeholder waiting for the owner (HANDOFF.md, "Open questions").
"""

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models import Category, Product, Setting, Staff
from app.services import stock

CATEGORIES = [
    # slug, name, sort_order, tint (HANDOFF.md design tokens)
    ("school-supplies", "School supplies", 1, "butter"),
    ("office-supplies", "Office supplies", 2, "lilac"),
    ("electronics", "Electronics", 3, "blush"),
    ("phone-accessories", "Phone accessories", 4, "sage"),
]

# From design/AdminProducts.dc.html (prices, cost, stock, low-stock alert) and
# design/MobileProducts.dc.html (shelf). The scientific calculator on the Shop design is left out until it
# has a real price, cost and stock.
PRODUCTS = [
    # sku, name, category slug, price, cost, stock, low-stock alert, location
    ("SCH-001", "A4 spiral notebook, 200 pages", "school-supplies", 2500, 1700, 64, 15, "Shelf A2"),
    ("SCH-002", "Ballpoint pens, pack of 10", "school-supplies", 3000, 2000, 52, 15, "Shelf A1"),
    ("SCH-003", "Geometry set", "school-supplies", 2000, 1300, 3, 10, "Shelf A3"),
    ("SCH-004", "Exercise books, pack of 12", "school-supplies", 6000, 4200, 5, 15, None),
    ("OFF-001", "A4 copy paper, 500 sheets", "office-supplies", 6500, 5000, 6, 20, "Store room"),
    ("OFF-002", "Lever arch box files", "office-supplies", 2800, 1800, 30, 10, None),
    ("OFF-003", "Heavy-duty stapler", "office-supplies", 9500, 6500, 2, 5, "Shelf B2"),
    ("ELE-001", "Wireless over-ear headphones", "electronics", 25000, 17000, 12, 4, "Glass case"),
    ("ELE-002", "USB flash drive, 32 GB", "electronics", 7000, 4500, 23, 8, "Glass case"),
    ("PHN-001", "USB-C fast charger", "phone-accessories", 8000, 5200, 18, 6, "Wall rack"),
    ("PHN-002", "Power bank, 10,000 mAh", "phone-accessories", 15000, 10500, 4, 8, "Glass case"),
]

# From design/AdminStaff.dc.html. The designs give no emails, so these use the .test domain.
STAFF = [
    # name, phone, email, role
    ("Patrick H.", "250788000001", "patrick@pahyems.test", "owner"),
    ("Eric M.", "250788000002", "eric@pahyems.test", "manager"),
    ("Grace U.", "250788000003", "grace@pahyems.test", "worker"),
    ("Diane K.", "250788000004", "diane@pahyems.test", "worker"),
]

SHOP_PHONE = "250786125023"  # 0786 125 023

SETTINGS: dict[str, object] = {
    "shop": {
        "name": "Pahyems Company Ltd",
        "address": "Huye – Tumba Center",
        "phone": SHOP_PHONE,
        # HANDOFF.md assumes the WhatsApp number is the shop phone.
        "whatsapp": SHOP_PHONE,
        "email": "[SHOP EMAIL]",
        "tin": "[TIN]",
    },
    # Sunday closed follows the S8 design sample; times are waiting for the owner.
    "hours": {
        day: {"open": "[OPENING TIME]", "close": "[CLOSING TIME]", "closed": day == "sun"}
        for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
    },
    "closures": [],
    "payment_methods": {
        "momo": {"enabled": True, "merchant_code": "[MERCHANT CODE]"},
        "airtel": {"enabled": True, "merchant_code": "[MERCHANT CODE]"},
        "pay_at_pickup": {"enabled": True},
    },
    "orders": {
        "allow_guest_checkout": True,
        "whatsapp_ready_button": True,
        "pickup_hold_days": 3,
    },
    "message_templates": {
        "order_ready": (
            "Hello {name}, your Pahyems order {order} is ready. Collect it at Huye – Tumba Center. "
            "Call 0786 125 023 with questions."
        ),
        "payment_rejected": "We couldn't confirm payment for {order}. [PAYMENT REJECTED MESSAGE]",
        # From design/MobileRequests.dc.html.
        "print_quote": "Hello {name}, your quote for {details} is {total}. Ready on {ready_on}. Reply YES or call 0786 125 023.",
        "print_ready": "Hello {name}, your Pahyems request {order} is ready. Collect it at Huye – Tumba Center.",
        # From design/AdminOrders.dc.html.
        "general": "Hello {name}, this is Pahyems about your order {order}.",
        "receipt": "Pahyems receipt {order}\n{items}\nTotal {total}\n{footer}",
    },
    "receipt": {
        "footer": "Thank you for shopping with us!",
        "returns_policy": "[RETURNS POLICY]",
        "show_tin": True,
    },
    "owner_alerts": {
        "email": "[OWNER EMAIL]",
        "cancel": True,
        "price": True,
        "stock": True,
        "daily": True,
        "login": False,
        # HANDOFF.md says staff changes alert the owner, but S8 has no switch for it yet.
        "staff": True,
    },
}


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def seed(db: Session, *, with_staff: bool = True) -> dict[str, int]:
    added = {"categories": 0, "products": 0, "staff": 0, "settings": 0}

    categories: dict[str, Category] = {c.slug: c for c in db.scalars(select(Category))}
    for slug, name, order, tint in CATEGORIES:
        if slug not in categories:
            categories[slug] = Category(slug=slug, name=name, sort_order=order, tint=tint)
            db.add(categories[slug])
            added["categories"] += 1
    db.flush()

    existing_skus = set(db.scalars(select(Product.sku)))
    for sku, name, category, price, cost, qty, alert, location in PRODUCTS:
        if sku in existing_skus:
            continue
        product = Product(
            sku=sku,
            name=name,
            slug=slugify(name),
            category_id=categories[category].id,
            description="[PRODUCT DESCRIPTION]",
            price_rwf=price,
            cost_rwf=cost,
            low_stock_alert=alert,
            location=location,
        )
        db.add(product)
        db.flush()
        # Stock only changes through movements, so opening stock is a delivery.
        stock.record_movement(db, product, qty, "received", unit_cost_rwf=cost, note="Opening stock (seed data)")
        added["products"] += 1

    existing_emails = set(db.scalars(select(Staff.email)))
    password_hash = hash_password(get_settings().seed_staff_password)
    for name, phone, email, role in STAFF if with_staff else []:
        if email not in existing_emails:
            db.add(Staff(name=name, phone=phone, email=email, role=role, password_hash=password_hash))
            added["staff"] += 1

    existing_keys = set(db.scalars(select(Setting.key)))
    for key, value in SETTINGS.items():
        if key not in existing_keys:
            db.add(Setting(key=key, value=value))
            added["settings"] += 1

    db.flush()
    return added


def main() -> None:
    if get_settings().environment == "production":
        raise SystemExit("The seed adds sample staff with a shared password. It doesn't run in production.")
    with SessionLocal() as db:
        added = seed(db)
        db.commit()
    print("Seed complete. Added: " + ", ".join(f"{n} {k}" for k, n in added.items()))


if __name__ == "__main__":
    main()
