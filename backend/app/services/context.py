from dataclasses import dataclass


@dataclass(frozen=True)
class RequestContext:
    """Where a request came from. Stored on sessions and activity log entries."""

    device: str | None = None  # user agent
    ip: str | None = None
