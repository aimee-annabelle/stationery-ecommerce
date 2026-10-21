import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import router as api_router
from app.api.v1.catalog import media_router
from app.core.config import Settings, get_settings
from app.core.db import SessionLocal
from app.services import daily_summary
from app.services.errors import ServiceError

logging.basicConfig(level=logging.INFO)

DEFAULT_SECRET = Settings.model_fields["jwt_secret"].default


def create_app() -> FastAPI:
    settings = get_settings()
    if settings.environment == "production" and (settings.jwt_secret == DEFAULT_SECRET or not settings.cookie_secure):
        raise RuntimeError("Set JWT_SECRET and COOKIE_SECURE=true before running in production.")

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        # The daily summary scheduler (a worker queue can replace this later; HANDOFF.md "Background jobs").
        task = None if settings.environment == "test" else asyncio.create_task(daily_summary.run_forever(SessionLocal))
        yield
        if task:
            task.cancel()

    app = FastAPI(title="Pahyems Store API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(ServiceError)
    def service_error(_: Request, exc: ServiceError) -> JSONResponse:
        content = {"detail": exc.message, "code": exc.code}
        if exc.details is not None:
            content["details"] = exc.details
        return JSONResponse(status_code=exc.status_code, content=content)

    app.include_router(api_router)
    app.include_router(media_router)
    return app


app = create_app()
