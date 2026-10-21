class ServiceError(Exception):
    """A rule was broken. Routers don't catch it: app.main turns it into a JSON error with this status."""

    status_code = 400

    def __init__(
        self, message: str, code: str | None = None, status_code: int | None = None, details: object = None
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details  # extra JSON for the client, for example which bag lines changed
        if status_code is not None:
            self.status_code = status_code


class NotAuthenticated(ServiceError):
    status_code = 401


class Forbidden(ServiceError):
    status_code = 403


class NotFound(ServiceError):
    status_code = 404


class Conflict(ServiceError):
    status_code = 409
