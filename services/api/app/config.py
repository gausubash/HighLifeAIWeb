from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    api_host: str = Field(default="127.0.0.1", alias="API_HOST")
    api_port: int = Field(default=8001, alias="API_PORT")
    database_url: str = Field(default="sqlite:///./data/highlife.db", alias="DATABASE_URL")
    storage_dir: Path = Field(default=Path("./data/storage"), alias="STORAGE_DIR")
    render_dpi: int = Field(default=350, alias="RENDER_DPI")
    preview_max_edge: int = Field(default=512, alias="PREVIEW_MAX_EDGE")
    cors_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        alias="CORS_ORIGINS",
    )
    detect_backend: str = Field(default="yolo", alias="DETECT_BACKEND")
    inference_api_url: str = Field(default="http://127.0.0.1:8000", alias="INFERENCE_API_URL")


@lru_cache
def get_settings() -> Settings:
    return Settings()
