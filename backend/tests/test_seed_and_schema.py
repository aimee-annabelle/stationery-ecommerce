from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import func, select, text

from app.models import Base, Category, Order, Product, Setting, Staff, StockMovement
from app.seed import PRODUCTS, seed


def test_migration_matches_the_models(db):
    context = MigrationContext.configure(db.connection(), opts={"compare_type": True})

    assert compare_metadata(context, Base.metadata) == []


def test_seed_adds_the_canvas_data(db):
    added = seed(db)

    assert added == {"categories": 4, "products": 11, "staff": 4, "settings": 8}
    roles = dict(db.execute(select(Staff.name, Staff.role)).all())
    assert roles == {"Patrick H.": "owner", "Eric M.": "manager", "Grace U.": "worker", "Diane K.": "worker"}
    stapler = db.scalar(select(Product).where(Product.sku == "OFF-003"))
    assert (stapler.price_rwf, stapler.cost_rwf, stapler.stock_qty, stapler.location) == (9500, 6500, 2, "Shelf B2")


def test_seed_stock_comes_from_movements(db):
    seed(db)

    for sku, *_, qty, _alert, _location in PRODUCTS:
        product = db.scalar(select(Product).where(Product.sku == sku))
        moved = db.scalar(select(func.sum(StockMovement.change_qty)).where(StockMovement.product_id == product.id))
        assert product.stock_qty == moved == qty


def test_seed_can_run_twice(db):
    seed(db)

    assert seed(db) == {"categories": 0, "products": 0, "staff": 0, "settings": 0}
    assert db.scalar(select(func.count()).select_from(Category)) == 4


def test_unknown_settings_stay_placeholders(db):
    seed(db)

    payments = db.scalar(select(Setting.value).where(Setting.key == "payment_methods"))
    assert payments["momo"]["merchant_code"] == "[MERCHANT CODE]"
    assert db.scalar(select(Setting.value).where(Setting.key == "orders"))["pickup_hold_days"] == 3


def test_order_numbers_count_up_and_never_truncate(db):
    def new_order() -> str:
        order = Order(source="online", payment_method="pay_at_pickup", payment_status="unpaid", total_rwf=0,
                      guest_name="Test", guest_phone="250788000000")
        db.add(order)
        db.flush()
        return order.number

    first = new_order()
    assert first.startswith("PH-") and len(first) == 7
    db.execute(text("SELECT setval('order_number_seq', 9999)"))
    assert new_order() == "PH-10000"
