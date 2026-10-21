"""The owner's daily summary email (HANDOFF.md, "Notifications"): sales, orders, requests and low stock.

Sent once a day at the time set in S8 (default 23:59, Kigali). `send_if_due` is safe to call often and from
several processes: the database row update decides who sends, so it goes out once.
"""

import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models import Order, PrintRequest
from app.services import dashboard, outbox, owner_alerts, shop_settings
from app.services.notifications import Email
from app.services.staff_orders import kigali_day_start

log = logging.getLogger(__name__)
SENT_KEY = "daily_summary_sent_on"


def build(db: Session, day) -> Email | None:
    to = owner_alerts.recipient(db)
    if not to:
        return None
    start, end = kigali_day_start(day), kigali_day_start(day + timedelta(days=1))
    rows = db.execute(
        select(Order.source, func.count(), func.coalesce(func.sum(Order.total_rwf), 0))
        .where(Order.created_at >= start, Order.created_at < end, Order.status != "cancelled").group_by(Order.source)
    ).all()
    by_source = {source: (count, int(total)) for source, count, total in rows}
    sales = sum(t for _, t in by_source.values())
    cancelled = db.scalar(select(func.count()).select_from(Order).where(Order.cancelled_at >= start, Order.cancelled_at < end)) or 0
    open_requests = db.scalar(select(func.count()).select_from(PrintRequest).where(PrintRequest.status.in_(("new", "quoted", "in_progress", "ready")))) or 0
    due = db.scalar(select(func.count()).select_from(PrintRequest).where(
        PrintRequest.status.in_(("new", "quoted", "in_progress")), PrintRequest.needed_by == day + timedelta(days=1))) or 0
    low = dashboard.low_stock(db, 10)
    lines = [
        f"Pahyems — {day.strftime('%A %d %B %Y')}",
        "",
        f"Sales: {sales:,} RWF",
        f"Orders: {sum(c for c, _ in by_source.values())} ({by_source.get('online', (0, 0))[0]} online, {by_source.get('walk_in', (0, 0))[0]} walk-in)",
        f"Cancelled today: {cancelled}",
        f"Print requests open: {open_requests} ({due} due tomorrow)",
        "",
        f"Low stock ({len(low)}):" if low else "Low stock: nothing below its alert level.",
        *[f"  {item['name']}: {item['left']} left (alert at {item['alert']})" for item in low],
    ]
    return Email(to, f"Pahyems daily summary — {day.strftime('%d %b')}", "\n".join(lines))


def send_if_due(db: Session, now: datetime | None = None) -> bool:
    """Sends today's summary if it's switched on, the time has passed and it hasn't gone yet."""
    alerts = shop_settings.get(db, "owner_alerts", {})
    if not alerts.get("daily"):
        return False
    now = (now or datetime.now(shop_settings.KIGALI)).astimezone(shop_settings.KIGALI)
    if now.strftime("%H:%M") < alerts.get("daily_time", "23:59"):
        return False
    today = now.date().isoformat()
    db.execute(text("INSERT INTO settings (key, value) VALUES (:k, to_jsonb(''::text)) ON CONFLICT (key) DO NOTHING"), {"k": SENT_KEY})
    claimed = db.execute(
        text("UPDATE settings SET value = to_jsonb(CAST(:d AS text)), updated_at = now() "
             "WHERE key = :k AND value <> to_jsonb(CAST(:d AS text)) RETURNING id"),
        {"k": SENT_KEY, "d": today},
    ).first()
    if claimed is None:
        return False
    email = build(db, now.date())
    if email:
        outbox.queue(db, email)
    return True


async def run_forever(session_factory, every_seconds: int = 30) -> None:
    """Started with the API (not in tests). Checks every 30 seconds."""
    while True:
        try:
            def tick() -> None:
                with session_factory() as db:
                    send_if_due(db)
                    db.commit()

            await asyncio.to_thread(tick)
        except Exception:
            log.exception("Daily summary check failed")
        await asyncio.sleep(every_seconds)
