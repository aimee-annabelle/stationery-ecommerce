from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Every value comes from the environment (see .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"

    database_url: str = "postgresql+psycopg://pahyems:pahyems@localhost:5432/pahyems"
    test_database_url: str = "postgresql+psycopg://pahyems:pahyems@localhost:5432/pahyems_test"

    jwt_secret: str = "dev-only-change-me-dev-only-change-me-dev-only"
    access_token_minutes: int = 15
    customer_refresh_days: int = 30
    staff_refresh_days: int = 7
    cookie_secure: bool = False

    frontend_origin: str = "http://localhost:5173"

    notifier: Literal["console", "smtp"] = "console"
    email_from: str = "Pahyems <no-reply@pahyems.test>"
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_starttls: bool = False

    verification_code_minutes: int = 15
    verification_code_max_attempts: int = 5
    password_min_length: int = 8

    seed_staff_password: str = "pahyems-dev-2026"


@lru_cache
def get_settings() -> Settings:
    return Settings()
