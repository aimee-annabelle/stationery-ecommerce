"""In-memory rate limiting for log-in, code and order-tracking endpoints.

Counts live in the API process, which is enough for one server. Move them to Postgres or Redis
if the API ever runs as several processes.
"""

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, Request, status


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def hit(self, key: str, limit: int, window_seconds: int) -> bool:
        """Records a hit and returns False if the key is over its limit."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] <= now - window_seconds:
                hits.popleft()
            if len(hits) >= limit:
                return False
            hits.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def rate_limit(bucket: str, limit: int, window_seconds: int):
    """FastAPI dependency: at most `limit` requests per IP address per window for this bucket."""

    def dependency(request: Request) -> None:
        if not limiter.hit(f"{bucket}:{client_ip(request)}", limit, window_seconds):
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Please wait a few minutes and try again.",
            )

    return dependency
