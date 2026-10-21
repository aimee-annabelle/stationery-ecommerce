"""S1 dashboard: the view for the signed-in staff member's role (design/AdminDashboard.dc.html).

Each section is included only if the role has the capability behind it, so a worker never receives
sales figures or the activity log.
"""

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.permissions import Capability, has_capability
from app.models import ActivityLog, LowStockFlag, Order, OrderItem, PrintRequest, Product, Staff, StockMovement
from app.services import shop_settings
from app.services.staff_orders import OPEN_STATUSES, customer_name, kigali_day_start, payment_label

RECENT = 5


def _today_range():
    today = shop_settings.today_in_kigali()
    start = kigali_day_start(today)
    return today, start, start + timedelta(days=1)


def sales_by_day(db: Session, days: int = 7) -> list[dict]:
    """Value of orders placed each day that weren't cancelled (online and walk-in)."""
    today = shop_settings.today_in_kigali()
    first = today - timedelta(days=days - 1)
    local_day = func.date(func.timezone("Africa/Kigali", Order.created_at))
    totals = dict(db.execute(
        select(local_day, func.sum(Order.total_rwf))
        .where(Order.created_at >= kigali_day_start(first), Order.status != "cancelled")
        .group_by(local_day)
    ).all())
    return [{"day": (first + timedelta(days=n)).isoformat(), "total_rwf": int(totals.get(first + timedelta(days=n), 0) or 0)}
            for n in range(days)]


def low_stock(db: Session, limit: int = 8) -> list[dict]:
    flagged = select(LowStockFlag.product_id).where(LowStockFlag.cleared_at.is_(None))
    rows = db.execute(
        select(Product.id, Product.name, Product.stock_qty, Product.low_stock_alert, Product.id.in_(flagged))
        .where(Product.stock_qty < Product.low_stock_alert)
        .order_by((Product.stock_qty * 1.0 / func.nullif(Product.low_stock_alert, 0)), Product.name)
        .limit(limit)
    ).all()
    return [{"product_id": r[0], "name": r[1], "left": r[2], "alert": r[3], "flagged": bool(r[4])} for r in rows]


def low_stock_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(Product).where(Product.stock_qty < Product.low_stock_alert)) or 0


def queue(db: Session, limit: int = 20) -> list[dict]:
    """Open orders to work through, oldest first."""
    orders = db.scalars(
        select(Order).where(Order.status.in_(OPEN_STATUSES)).order_by(Order.created_at, Order.number).limit(limit)
    ).all()
    counts = dict(db.execute(
        select(OrderItem.order_id, func.sum(OrderItem.qty))
        .where(OrderItem.order_id.in_([o.id for o in orders])).group_by(OrderItem.order_id)
    ).all()) if orders else {}
    return [
        {"id": o.id, "number": o.number, "customer": customer_name(o), "items": int(counts.get(o.id, 0)),
         "payment": payment_label(o), "payment_status": o.payment_status, "payment_method": o.payment_method,
         "status": o.status}
        for o in orders
    ]


def build(db: Session, staff: Staff) -> dict:
    role = staff.role
    today, start, end = _today_range()
    open_counts = dict(db.execute(
        select(Order.status, func.count()).where(Order.status.in_(OPEN_STATUSES)).group_by(Order.status)
    ).all())
    open_requests = db.scalar(select(func.count()).select_from(PrintRequest)
                              .where(PrintRequest.status.notin_(("collected", "cancelled")))) or 0
    to_quote = db.scalar(select(func.count()).select_from(PrintRequest).where(PrintRequest.status == "new")) or 0
    out: dict = {"role": role, "today": today.isoformat()}

    if has_capability(role, Capability.REPORTS_VIEW):
        today_orders = db.execute(
            select(func.count(), func.coalesce(func.sum(Order.total_rwf), 0))
            .where(Order.created_at >= start, Order.created_at < end, Order.status != "cancelled")
        ).one()
        out["kpis"] = {"sales_today_rwf": int(today_orders[1]), "orders_today": today_orders[0],
                       "open_print_requests": open_requests, "low_stock_items": low_stock_count(db)}
        out["sales_7d"] = sales_by_day(db)
        out["low_stock"] = low_stock(db, 5)
    elif has_capability(role, Capability.STOCK_MANAGE):
        week_ago = start - timedelta(days=6)
        deliveries = db.scalar(select(func.count()).select_from(StockMovement)
                               .where(StockMovement.reason == "received", StockMovement.staff_id.is_not(None),
                                      StockMovement.created_at >= week_ago)) or 0
        out["kpis"] = {"low_stock_items": low_stock_count(db),
                       "products_listed": db.scalar(select(func.count()).select_from(Product).where(Product.is_visible.is_(True))) or 0,
                       "deliveries_this_week": deliveries, "open_orders": sum(open_counts.values())}
        out["restock"] = low_stock(db)
        moves = db.execute(
            select(Product.name, StockMovement.change_qty, StockMovement.reason, Staff.name, StockMovement.order_id)
            .join(Product, Product.id == StockMovement.product_id)
            .outerjoin(Staff, Staff.id == StockMovement.staff_id)
            .order_by(StockMovement.created_at.desc()).limit(RECENT)
        ).all()
        out["moves"] = [{"name": m[0], "change": m[1], "reason": m[2],
                         "by": m[3] or ("Online order" if m[4] else "System")} for m in moves]
    else:
        out["kpis"] = {"to_prepare": open_counts.get("new", 0) + open_counts.get("preparing", 0),
                       "ready": open_counts.get("ready", 0), "requests_to_quote": to_quote}

    # Everyone works the queue (M1, and the worker S1).
    out["queue"] = queue(db)

    if has_capability(role, Capability.ACTIVITY_VIEW):
        entries = db.execute(
            select(ActivityLog.action, ActivityLog.entity_label, ActivityLog.after, ActivityLog.at, Staff.name)
            .join(Staff, Staff.id == ActivityLog.staff_id)
            .where(ActivityLog.at >= start, ActivityLog.at < end)
            .order_by(ActivityLog.at.desc()).limit(RECENT)
        ).all()
        out["activity"] = [{"action": e[0], "label": e[1], "after": e[2], "at": e[3], "who": e[4]} for e in entries]
        shift = db.execute(
            select(Staff.name, Staff.role, func.count(ActivityLog.id))
            .join(ActivityLog, ActivityLog.staff_id == Staff.id)
            .where(ActivityLog.at >= start, ActivityLog.at < end, Staff.role != "owner")
            .group_by(Staff.id, Staff.name, Staff.role)
            .order_by(func.count(ActivityLog.id).desc())
        ).all()
        out["on_shift"] = [{"name": s[0], "role": s[1], "actions": s[2]} for s in shift]
    return out

