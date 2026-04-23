from pydantic_settings import BaseSettings
from motor.motor_asyncio import AsyncIOMotorClient
from functools import lru_cache


class Settings(BaseSettings):
    mongo_uri:                   str = "mongodb://localhost:27017"
    db_name:                     str = "podium_ai"
    jwt_secret:                  str = "change-this-secret"
    jwt_algorithm:               str = "HS256"
    access_token_expire_minutes: int = 10080   # 7 days
    frontend_origin:             str = "http://127.0.0.1:5500"

    # ── SMTP (Gmail recommended — use an App Password) ──────────
    smtp_host:     str = "smtp.gmail.com"
    smtp_port:     int = 587
    smtp_user:     str = ""          # your-gmail@gmail.com
    smtp_password: str = ""          # Gmail App Password (16 chars)
    smtp_from:     str = ""          # e.g. "Podium AI <your-gmail@gmail.com>"

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


# ── MongoDB client ──────────────────────────────────────────
_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        settings = get_settings()
        _client = AsyncIOMotorClient(settings.mongo_uri)
    return _client


def get_db():
    settings = get_settings()
    return get_client()[settings.db_name]
