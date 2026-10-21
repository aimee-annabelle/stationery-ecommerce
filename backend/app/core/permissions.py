"""Staff capabilities, mapped to roles in code (HANDOFF.md, "Users, roles and permissions").

Routes and services check capabilities, never role names, so this table is the only place to change
when a role gains or loses a permission.
"""

from enum import StrEnum


class Role(StrEnum):
    OWNER = "owner"
    MANAGER = "manager"
    WORKER = "worker"


class Capability(StrEnum):
    # Create orders and walk-in sales
    ORDERS_CREATE = "orders.create"
    # Update order status
    ORDERS_UPDATE_STATUS = "orders.update_status"
    # Mark a MoMo / Airtel payment as verified
    PAYMENTS_VERIFY = "payments.verify"
    # Cancel orders and give refunds
    ORDERS_CANCEL = "orders.cancel"
    ORDERS_REFUND = "orders.refund"
    # Add and handle print requests, send quotes
    PRINT_REQUESTS_MANAGE = "print_requests.manage"
    # See products and stock levels (workers: view only)
    PRODUCTS_VIEW = "products.view"
    # Add or edit products and prices
    PRODUCTS_EDIT = "products.edit"
    # Receive and adjust stock
    STOCK_MANAGE = "stock.manage"
    # See cost prices and margins
    COSTS_VIEW = "costs.view"
    # Reports and exports
    REPORTS_VIEW = "reports.view"
    # Activity log (who did what)
    ACTIVITY_VIEW = "activity.view"
    # Add staff and change roles
    STAFF_MANAGE = "staff.manage"
    # Shop settings (hours, payments, receipts, alerts)
    SETTINGS_MANAGE = "settings.manage"


_WORKER = frozenset(
    {
        Capability.ORDERS_CREATE,
        Capability.ORDERS_UPDATE_STATUS,
        Capability.PAYMENTS_VERIFY,
        Capability.PRINT_REQUESTS_MANAGE,
        Capability.PRODUCTS_VIEW,
    }
)

_MANAGER = _WORKER | {
    Capability.ORDERS_CANCEL,
    Capability.ORDERS_REFUND,
    Capability.PRODUCTS_EDIT,
    Capability.STOCK_MANAGE,
    Capability.COSTS_VIEW,
}

ROLE_CAPABILITIES: dict[Role, frozenset[Capability]] = {
    # The owner has full access with no restrictions.
    Role.OWNER: frozenset(Capability),
    Role.MANAGER: frozenset(_MANAGER),
    Role.WORKER: _WORKER,
}


def capabilities_for(role: str) -> frozenset[Capability]:
    return ROLE_CAPABILITIES.get(Role(role), frozenset())


def has_capability(role: str, capability: Capability) -> bool:
    return capability in capabilities_for(role)
