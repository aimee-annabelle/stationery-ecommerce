"""Plain words for activity log entries ("marked order PH-0012 as Ready"). Used by the dashboard, S6, M6
and the CSV export, so the wording is the same everywhere."""

from typing import Any

STATUS = {"new": "New", "preparing": "Preparing", "ready": "Ready", "collected": "Collected", "cancelled": "Cancelled",
          "quoted": "Quoted", "in_progress": "In progress"}
KIND_LABELS = {"orders": "Orders", "products": "Products", "stock": "Stock", "requests": "Requests", "staff": "Staff",
               "settings": "Settings"}


def _rwf(value: Any) -> str:
    try:
        return f"{int(value):,} RWF"
    except (TypeError, ValueError):
        return "—"


def describe(action: str, label: str | None, before: dict | None, after: dict | None) -> str:
    b, a, x = before or {}, after or {}, label or ""
    match action:
        case "order.created":
            return f"recorded walk-in sale {x} ({_rwf(a.get('total_rwf'))})"
        case "order.status_changed":
            return f"marked order {x} as {STATUS.get(a.get('status'), a.get('status'))}"
        case "order.item_picked":
            return f"{'ticked' if a.get('picked') else 'unticked'} {a.get('item')} on {x}"
        case "order.cancelled":
            return f"cancelled order {x}: {a.get('reason')}"
        case "order.refunded":
            return f"refunded {_rwf(a.get('amount_rwf'))} on order {x}"
        case "order.payment_verified":
            return f"confirmed the MoMo payment for {x} ({_rwf(a.get('amount_rwf'))})"
        case "order.payment_rejected":
            return f"couldn't find the payment for {x}"
        case "order.whatsapp_opened" | "print_request.whatsapp_opened":
            return f"opened WhatsApp ({a.get('template')}) for {x}"
        case "product.created":
            return f"added product {x}"
        case "product.updated":
            return f"edited {x} ({', '.join(sorted(a))})"
        case "product.price_changed":
            return f"changed the price of {x} from {_rwf(b.get('price_rwf'))} to {_rwf(a.get('price_rwf'))}"
        case "product.visibility_changed":
            return f"{'showed' if a.get('is_visible') else 'hid'} {x} in the shop"
        case "product.low_stock_flagged":
            return f"flagged {x} as running low"
        case "product.variant_added":
            return f"added option {a.get('variant')} to {x}"
        case "product.variant_removed":
            return f"removed option {b.get('variant')} from {x}"
        case "product.image_added" | "product.image_removed":
            return f"{'added' if action.endswith('added') else 'removed'} a photo of {x}"
        case "stock.received":
            return f"received {a.get('received')} × {x}"
        case "stock.adjusted":
            change = a.get("change")
            return f"adjusted stock of {x} by {change:+d} ({a.get('reason')})" if isinstance(change, int) else f"adjusted stock of {x}"
        case "category.created" | "category.updated" | "category.deleted":
            return f"{action.split('.')[1]} category {x}"
        case "print_request.created":
            return f"created print request {x} ({a.get('summary')})"
        case "print_request.quoted":
            return f"quoted {_rwf(a.get('quote_rwf'))} for {x}"
        case "print_request.status_changed":
            return f"moved {x} to {STATUS.get(a.get('status'), a.get('status'))}"
        case "print_request.assigned":
            return f"assigned {x} to {a.get('name')}"
        case "staff.added":
            return f"added {x} as {str(a.get('role', '')).capitalize()}"
        case "staff.role_changed":
            return f"changed {x} from {str(b.get('role', '')).capitalize()} to {str(a.get('role', '')).capitalize()}"
        case "staff.access_removed":
            return f"removed access for {x}"
        case "staff.access_restored":
            return f"restored access for {x}"
        case "staff.signed_in_new_device":
            return "signed in on a new device"
        case "settings.updated":
            return f"updated shop settings ({', '.join(sorted(a))})"
        case "contact.handled":
            return f"handled the message from {x}"
    return f"{action.replace('.', ' ').replace('_', ' ')} {x}".strip()
