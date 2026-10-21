"""Notifier: every message the server sends goes through here (HANDOFF.md, "Notifications").

v1 sends email only. WhatsApp messages are click-to-chat links that staff send themselves (built in stage 4).
Paid SMS can be added later as another Notifier without changing callers.
"""

import logging
import smtplib
import time
from dataclasses import dataclass
from email.message import EmailMessage
from functools import lru_cache
from typing import Protocol

from fastapi import BackgroundTasks

from app.core.config import get_settings

log = logging.getLogger(__name__)

EMAIL_RETRIES = 3


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    body: str


class Notifier(Protocol):
    def send_email(self, email: Email) -> None: ...


class ConsoleNotifier:
    """Prints emails to the API log. Used when no mail server is configured."""

    def send_email(self, email: Email) -> None:
        log.info("Email to %s | %s\n%s", email.to, email.subject, email.body)


class SmtpNotifier:
    """Sends through SMTP: Mailpit in development, a free-tier provider (Brevo, Resend) in production."""

    def send_email(self, email: Email) -> None:
        settings = get_settings()
        message = EmailMessage()
        message["From"] = settings.email_from
        message["To"] = email.to
        message["Subject"] = email.subject
        message.set_content(email.body)
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_starttls:
                smtp.starttls()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password or "")
            smtp.send_message(message)


@lru_cache
def get_notifier() -> Notifier:
    return SmtpNotifier() if get_settings().notifier == "smtp" else ConsoleNotifier()


def _send_with_retries(notifier: Notifier, email: Email) -> None:
    for attempt in range(1, EMAIL_RETRIES + 1):
        try:
            notifier.send_email(email)
            return
        except Exception:
            log.exception("Email to %s failed (attempt %s of %s)", email.to, attempt, EMAIL_RETRIES)
            if attempt < EMAIL_RETRIES:
                time.sleep(2**attempt)


def send_later(background: BackgroundTasks, notifier: Notifier, email: Email) -> None:
    """Sends after the response, with retries. A failed email never fails the request that caused it."""
    background.add_task(_send_with_retries, notifier, email)


# Email texts. They live here, not in Settings, because staff don't edit them.


def signup_code_email(to: str, code: str) -> Email:
    return Email(to, "Your Pahyems code", f"Your Pahyems code is {code}\n\nIt works for 15 minutes.")


def reset_code_email(to: str, code: str) -> Email:
    return Email(
        to,
        "Reset your Pahyems password",
        f"Your reset code is {code}\n\nIt works for 15 minutes. If you didn't ask for this, ignore this email.",
    )
