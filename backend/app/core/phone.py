"""Rwandan phone numbers are stored as 2507XXXXXXXX and shown as 07XX XXX XXX."""

import re

_DIGITS = re.compile(r"\D")


def normalize_phone(raw: str) -> str:
    """Accepts 07XX XXX XXX, +250 7XX XXX XXX or 2507XXXXXXXX. Raises ValueError otherwise."""
    digits = _DIGITS.sub("", raw or "")
    if digits.startswith("250"):
        digits = digits[3:]
    elif digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 9 or not digits.startswith("7"):
        raise ValueError("Enter a Rwandan mobile number, for example 0788 123 456")
    return "250" + digits


def format_phone(stored: str) -> str:
    local = "0" + stored[3:]
    return f"{local[:4]} {local[4:7]} {local[7:]}"
