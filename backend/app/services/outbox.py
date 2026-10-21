"""Emails that must only go out if the change that caused them is saved (owner alerts, receipts).

Services call `queue(db, email)` inside the transaction. When the session commits, the queued emails are
sent in a background thread with retries; if it rolls back, they are dropped. A failed email never blocks
the change (HANDOFF.md, "Notifications").
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.services.notifications import Email, Notifier, _send_with_retries, get_notifier

log = logging.getLogger(__name__)
_KEY = "outbox"
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="outbox")

# Tests swap these to capture emails and send them straight away.
notifier_factory: Callable[[], Notifier] = get_notifier
run: Callable[[Callable[[], None]], None] = lambda job: _pool.submit(job)  # noqa: E731


def queue(db: Session, email: Email) -> None:
    db.info.setdefault(_KEY, []).append(email)


@event.listens_for(Session, "after_commit")
def _send_after_commit(session: Session) -> None:
    emails = session.info.pop(_KEY, [])
    if not emails:
        return
    notifier = notifier_factory()
    for email in emails:
        run(lambda email=email: _send_with_retries(notifier, email))


@event.listens_for(Session, "after_rollback")
def _drop_after_rollback(session: Session) -> None:
    if session.info.pop(_KEY, None):
        log.info("Dropped queued emails after a rollback")

