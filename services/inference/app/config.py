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

    api_host: str = Field(default="127.0.0.1", alias="API_HOST")
    api_port: int = Field(default=8000, alias="API_PORT")

    supabase_url: str = Field(default="", alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(default="", alias="SUPABASE_SERVICE_ROLE_KEY")

    software_commit: str = Field(default="local-dev", alias="SOFTWARE_COMMIT")
    policy_version: str = Field(default="draft-v1", alias="POLICY_VERSION")
    dataset_version: str = Field(default="v1", alias="DATASET_VERSION")

    use_layout_detector: bool = Field(default=False, alias="USE_LAYOUT_DETECTOR")
    use_room_detector: bool = Field(default=False, alias="USE_ROOM_DETECTOR")
    yolo_weights: str = Field(default="", alias="YOLO_WEIGHTS")
    yolo_conf: float = Field(default=0.25, alias="YOLO_CONF")
    yolo_imgsz: int = Field(default=1280, alias="YOLO_IMGSZ")
    yolo_crop_pad: float = Field(default=0.02, alias="YOLO_CROP_PAD")
    yolo_room_weights: str = Field(default="", alias="YOLO_ROOM_WEIGHTS")
    yolo_room_conf: float = Field(default=0.25, alias="YOLO_ROOM_CONF")
    yolo_room_imgsz: int = Field(default=640, alias="YOLO_ROOM_IMGSZ")
    yolo_wall_weights: str = Field(
        default="https://huggingface.co/GreenMap/yolo11x-blueprint-wall-detector/resolve/main/yolo_walls_obb.pt",
        alias="YOLO_WALL_WEIGHTS",
    )
    yolo_wall_conf: float = Field(default=0.25, alias="YOLO_WALL_CONF")
    yolo_wall_imgsz: int = Field(default=896, alias="YOLO_WALL_IMGSZ")
    wall_backend: str = Field(default="mitunet", alias="WALL_BACKEND")
    mitunet_wall_weights: str = Field(
        default=(
            "https://media.githubusercontent.com/media/aliasstudio/mitunet/master/"
            "experiments/models/mitunet_finetune_a6_mit_b4_tversky_8864_28E.pth"
        ),
        alias="MITUNET_WALL_WEIGHTS",
    )
    mitunet_wall_threshold: float = Field(default=0.5, alias="MITUNET_WALL_THRESHOLD")
    mitunet_wall_imgsz: int = Field(default=512, alias="MITUNET_WALL_IMGSZ")

    roboflow_api_key: str = Field(default="", alias="ROBOFLOW_API_KEY")
    roboflow_model_id: str = Field(default="floorplan-iculh/1", alias="ROBOFLOW_MODEL_ID")
    roboflow_conf: float = Field(default=0.25, alias="ROBOFLOW_CONF")


@lru_cache
def get_settings() -> Settings:
    return Settings()
