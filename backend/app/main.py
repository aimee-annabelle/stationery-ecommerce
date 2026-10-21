import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import router as api_router
from app.core.config import Settings, get_settings
from app.services.errors import ServiceError

logging.basicConfig(level=logging.INFO)

DEFAULT_SECRET = Settings.model_fields["jwt_secret"].default


def create_app() -> FastAPI:
    settings = get_settings()
    if settings.environment == "production" and (settings.jwt_secret == DEFAULT_SECRET or not settings.cookie_secure):
        raise RuntimeError("Set JWT_SECRET and COOKIE_SECURE=true before running in production.")

    app = FastAPI(title="Pahyems Store API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(ServiceError)
    def service_error(_: Request, exc: ServiceError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.message, "code": exc.code})

    app.include_router(api_router)
    return app


app = create_app()
