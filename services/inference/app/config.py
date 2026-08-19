"""Application configuration from environment variables."""

from __future__ import annotations

from enum import Enum
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class RunMode(str, Enum):
    MOCK = "mock"
    REAL = "real"


class Device(str, Enum):
    CPU = "cpu"
    CUDA = "cuda"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    run_mode: RunMode = Field(default=RunMode.MOCK, alias="RUN_MODE")
    device: Device = Field(default=Device.CPU, alias="DEVICE")

    supabase_url: str = Field(default="", alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(default="", alias="SUPABASE_SERVICE_ROLE_KEY")

    software_commit: str = Field(default="local-dev", alias="SOFTWARE_COMMIT")
    policy_version: str = Field(default="draft-v1", alias="POLICY_VERSION")
    dataset_version: str = Field(default="v1", alias="DATASET_VERSION")


@lru_cache
def get_settings() -> Settings:
    return Settings()
