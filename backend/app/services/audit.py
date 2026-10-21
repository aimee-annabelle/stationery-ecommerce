"""Activity log service (HANDOFF.md, "Activity log and sensitive actions").

Every change a staff member makes calls `record` before the caller commits, so the change and its log
entry are saved in the same transaction. Nothing here commits, updates or deletes.
"""

import json
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.models import ActivityLog, Staff
from app.services.context import RequestContext


@dataclass(frozen=True)
class ActionSpec:
    kind: str  # S6 filter group: orders, products, stock, requests, staff, settings
    sensitive: bool = False
    # Owner email alert switch in Settings, or None for "log only". Emails are sent from stage 6.
    owner_alert: str | None = None


# Every action the app can log. `record` refuses anything not listed, so sensitivity is decided here only.
ACTIONS: dict[str, ActionSpec] = {
    # Orders
    "order.created": ActionSpec("orders"),
    "order.status_changed": ActionSpec("orders"),
    "order.item_picked": ActionSpec("orders"),
    "order.whatsapp_opened": ActionSpec("orders"),
    "order.cancelled": ActionSpec("orders", sensitive=True, owner_alert="cancel"),
    "order.refunded": ActionSpec("orders", sensitive=True, owner_alert="cancel"),
    "order.payment_verified": ActionSpec("orders", sensitive=True),
    "order.payment_rejected": ActionSpec("orders", sensitive=True),
    # Products
    "product.created": ActionSpec("products"),
    "product.updated": ActionSpec("products"),
    "product.price_changed": ActionSpec("products", sensitive=True, owner_alert="price"),
    "product.visibility_changed": ActionSpec("products"),
    "product.low_stock_flagged": ActionSpec("products"),
    "product.variant_added": ActionSpec("products"),
    "product.variant_updated": ActionSpec("products"),
    "product.variant_removed": ActionSpec("products"),
    "product.image_added": ActionSpec("products"),
    "product.image_removed": ActionSpec("products"),
    "category.created": ActionSpec("products"),
    "category.updated": ActionSpec("products"),
    "category.deleted": ActionSpec("products"),
    # Stock
    "stock.received": ActionSpec("stock"),
    "stock.adjusted": ActionSpec("stock", sensitive=True, owner_alert="stock"),
    # Print requests
    "print_request.created": ActionSpec("requests"),
    "print_request.quoted": ActionSpec("requests"),
    "print_request.status_changed": ActionSpec("requests"),
    "print_request.assigned": ActionSpec("requests"),
    "print_request.whatsapp_opened": ActionSpec("requests"),
    # Staff
    "staff.added": ActionSpec("staff", sensitive=True, owner_alert="staff"),
    "staff.role_changed": ActionSpec("staff", sensitive=True, owner_alert="staff"),
    "staff.access_removed": ActionSpec("staff", sensitive=True, owner_alert="staff"),
    "staff.access_restored": ActionSpec("staff", sensitive=True, owner_alert="staff"),
    "staff.signed_in_new_device": ActionSpec("staff", sensitive=True, owner_alert="login"),
    # Settings
    "settings.updated": ActionSpec("settings", sensitive=True),
    # Contact messages
    "contact.handled": ActionSpec("requests"),
}


def _jsonable(value: dict[str, Any] | None) -> dict[str, Any] | None:
    """UUIDs, dates and other values become strings, so before/after fit in a JSONB column."""
    if value is None:
        return None
    return json.loads(json.dumps(value, default=str))


def record(
    db: Session,
    actor: Staff,
    action: str,
    *,
    entity_type: str,
    entity_id: uuid.UUID | None = None,
    entity_label: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    context: RequestContext | None = None,
) -> ActivityLog:
    spec = ACTIONS.get(action)
    if spec is None:
        raise ValueError(f"Unknown activity log action {action!r}. Add it to app.services.audit.ACTIONS.")

    context = context or RequestContext()
    entry = ActivityLog(
        staff_id=actor.id,
        action=action,
        kind=spec.kind,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_label=entity_label,
        before=_jsonable(before),
        after=_jsonable(after),
        is_sensitive=spec.sensitive,
        device=(context.device or "")[:512] or None,
        ip=context.ip,
    )
    db.add(entry)
    db.flush()
    return entry
