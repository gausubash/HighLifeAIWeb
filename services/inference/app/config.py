"""Application configuration from environment variables."""

from __future__ import annotations

import logging
from enum import Enum
from functools import lru_cache
try:
    from typing import Self
except ImportError:  # Python 3.10
    from typing_extensions import Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class RunMode(str, Enum):
    MOCK = "mock"
    REAL = "real"


class Device(str, Enum):
    CPU = "cpu"
    CUDA = "cuda"
    AUTO = "auto"


def torch_cuda_available() -> bool:
    """Best-effort CUDA probe (False when torch missing or no GPU)."""
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def resolve_device(device: Device) -> Device:
    """Resolve DEVICE=auto/cuda to cpu when no GPU is visible to torch."""
    if device == Device.CPU:
        return Device.CPU
    if torch_cuda_available():
        return Device.CUDA
    if device == Device.CUDA:
        logger.warning("DEVICE=cuda but torch.cuda.is_available() is false — using cpu")
    return Device.CPU


def runtime_torch_device(settings: "Settings | None" = None) -> str:
    """PyTorch/Ultralytics runtime device: cuda when available, else cpu."""
    settings = settings or get_settings()
    if settings.device == Device.CPU:
        return "cpu"
    if torch_cuda_available():
        return "cuda"
    if settings.device == Device.CUDA:
        logger.warning(
            "DEVICE=cuda but torch.cuda.is_available() is false at runtime — using cpu"
        )
    return "cpu"


def yolo_predict_device(settings: "Settings | None" = None) -> str | int:
    """Ultralytics predict() device: 0 for GPU, 'cpu' otherwise."""
    return 0 if runtime_torch_device(settings) == "cuda" else "cpu"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    run_mode: RunMode = Field(default=RunMode.MOCK, alias="RUN_MODE")
    device: Device = Field(default=Device.AUTO, alias="DEVICE")

    api_host: str = Field(default="127.0.0.1", alias="API_HOST")
    api_port: int = Field(default=8000, alias="API_PORT")

    supabase_url: str = Field(default="", alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(default="", alias="SUPABASE_SERVICE_ROLE_KEY")

    software_commit: str = Field(default="local-dev", alias="SOFTWARE_COMMIT")
    policy_version: str = Field(default="highlife_v1", alias="POLICY_VERSION")
    dataset_version: str = Field(default="v1", alias="DATASET_VERSION")

    use_layout_detector: bool = Field(default=False, alias="USE_LAYOUT_DETECTOR")
    layout_only: bool = False
    use_room_detector: bool = Field(default=False, alias="USE_ROOM_DETECTOR")
    # Runtime detect family: walls | rooms | objects | layout
    detect_task: str = Field(default="walls", alias="DETECT_TASK")
    # Room detector: architect (YOLO) or roboflow (Universe floorplan-9fxye)
    room_backend: str = Field(default="architect", alias="ROOM_BACKEND")
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
    wall_cascade_swin_weights: str = Field(
        default="models/cascade_swin_latest.pth",
        alias="WALL_CASCADE_SWIN_WEIGHTS",
    )
    wall_faster_rcnn_weights: str = Field(
        default="models/faster_rcnn_latest.pth",
        alias="WALL_FASTER_RCNN_WEIGHTS",
    )
    wall_retinanet_weights: str = Field(
        default="models/retinanet_latest.pth",
        alias="WALL_RETINANET_WEIGHTS",
    )
    floordata_deeplab_weights: str = Field(
        default="models/deeplab_walls_best.h5",
        alias="FLOORDATA_DEEPLAB_WEIGHTS",
    )
    floordata_unet_weights: str = Field(
        default="models/unet_walls_best.h5",
        alias="FLOORDATA_UNET_WEIGHTS",
    )
    floordata_threshold: float = Field(default=0.5, alias="FLOORDATA_WALL_THRESHOLD")
    floordata_imgsz: int = Field(default=512, alias="FLOORDATA_WALL_IMGSZ")
    # Dedicated Python for floorData train (default: services/inference/.venv-tf).
    tensorflow_python: str = Field(default="", alias="TENSORFLOW_PYTHON")
    mitunet_wall_weights: str = Field(
        default=(
            "https://media.githubusercontent.com/media/aliasstudio/mitunet/master/"
            "experiments/models/mitunet_finetune_a6_mit_b4_tversky_8864_28E.pth"
        ),
        alias="MITUNET_WALL_WEIGHTS",
    )
    mitunet_wall_threshold: float = Field(default=0.5, alias="MITUNET_WALL_THRESHOLD")
    mitunet_wall_imgsz: int = Field(default=512, alias="MITUNET_WALL_IMGSZ")

    # Overlapping tiles for large pages (Studio Infer + wall detect).
    detect_tile_enabled: bool = Field(default=True, alias="DETECT_TILE_ENABLED")
    detect_tile_size: int = Field(default=640, alias="DETECT_TILE_SIZE")
    detect_tile_overlap: float = Field(default=0.2, alias="DETECT_TILE_OVERLAP")
    detect_tile_min_side: int = Field(default=1280, alias="DETECT_TILE_MIN_SIDE")
    detect_tile_iou: float = Field(default=0.45, alias="DETECT_TILE_IOU")

    # Train-time overlapping crops (LabelMe → YOLO / RetinaNet / floorData).
    train_tile_enabled: bool = Field(default=True, alias="TRAIN_TILE_ENABLED")
    train_tile_size: int = Field(default=640, alias="TRAIN_TILE_SIZE")
    train_tile_overlap: float = Field(default=0.2, alias="TRAIN_TILE_OVERLAP")
    train_tile_min_side: int = Field(default=1280, alias="TRAIN_TILE_MIN_SIDE")
    train_keep_full_page_frac: float = Field(default=0.15, alias="TRAIN_KEEP_FULL_PAGE_FRAC")

    # Sheet-level VLM / OCR context (optional).
    vlm_enabled: bool = Field(default=False, alias="VLM_ENABLED")
    vlm_provider: str = Field(default="heuristic", alias="VLM_PROVIDER")
    vlm_api_url: str = Field(default="", alias="VLM_API_URL")
    vlm_api_key: str = Field(default="", alias="VLM_API_KEY")
    vlm_model: str = Field(default="", alias="VLM_MODEL")
    # Never POST floor-plan rasters to VLM_API_URL unless explicitly opted in.
    vlm_allow_remote_images: bool = Field(default=False, alias="VLM_ALLOW_REMOTE_IMAGES")
    # Local PaddleOCR (Python 3.10–3.12; default interpreter: .venv-tf)
    paddle_ocr_enabled: bool = Field(default=False, alias="PADDLE_OCR_ENABLED")
    paddle_ocr_python: str = Field(default="", alias="PADDLE_OCR_PYTHON")
    paddle_ocr_lang: str = Field(default="en", alias="PADDLE_OCR_LANG")
    paddle_ocr_use_gpu: bool = Field(default=False, alias="PADDLE_OCR_USE_GPU")
    # classic = PP-OCR det+rec (requirements-paddle.txt). vl = PaddleOCR-VL 0.9B VLM.
    paddle_ocr_backend: str = Field(default="classic", alias="PADDLE_OCR_BACKEND")
    paddle_ocr_vl_pipeline_version: str = Field(default="v1", alias="PADDLE_OCR_VL_PIPELINE_VERSION")
    paddle_ocr_vl_max_side: int = Field(default=2048, alias="PADDLE_OCR_VL_MAX_SIDE")
    # Local Hugging Face snapshot of PaddlePaddle/PaddleOCR-VL (empty = models/paddleocr-vl if present).
    paddle_ocr_vl_rec_model_dir: str = Field(default="", alias="PADDLE_OCR_VL_REC_MODEL_DIR")
    paddle_ocr_vl_layout_model_dir: str = Field(default="", alias="PADDLE_OCR_VL_LAYOUT_MODEL_DIR")
    # PaddleOCR default det_limit_side_len is 960 (det_limit_type=max: downscale only).
    paddle_ocr_det_limit_side_len: int = Field(default=960, alias="PADDLE_OCR_DET_LIMIT_SIDE_LEN")
    # Drawing-area OCR: keep more resolution so small room labels survive downsampling.
    paddle_ocr_dense_det_limit_side_len: int = Field(
        default=4096, alias="PADDLE_OCR_DENSE_DET_LIMIT_SIDE_LEN"
    )
    paddle_ocr_dense_db_thresh: float = Field(default=0.25, alias="PADDLE_OCR_DENSE_DB_THRESH")
    paddle_ocr_max_lines: int = Field(default=500, alias="PADDLE_OCR_MAX_LINES")
    # Same pattern as YOLO infer/train: overlapping tiles at the model input size (960).
    # Tile when the image is larger than 960 so Paddle does not downscale small text away.
    # Crops smaller than 960 are upsampled to 960 before OCR.
    paddle_ocr_tile_enabled: bool = Field(default=True, alias="PADDLE_OCR_TILE_ENABLED")
    paddle_ocr_tile_size: int = Field(default=960, alias="PADDLE_OCR_TILE_SIZE")
    paddle_ocr_tile_overlap: float = Field(default=0.25, alias="PADDLE_OCR_TILE_OVERLAP")
    paddle_ocr_tile_min_side: int = Field(default=960, alias="PADDLE_OCR_TILE_MIN_SIDE")

    policy_pack_path: str = Field(
        default="",
        alias="POLICY_PACK_PATH",
        description="Path to YAML design-policy pack. Empty → configs/policies/highlife_v1.yaml",
    )

    roboflow_api_key: str = Field(default="", alias="ROBOFLOW_API_KEY")
    roboflow_model_id: str = Field(default="floorplan-iculh/1", alias="ROBOFLOW_MODEL_ID")
    roboflow_wall_model_id: str = Field(
        default="archvision_wall_detect/1",
        alias="ROBOFLOW_WALL_MODEL_ID",
    )
    roboflow_room_model_id: str = Field(
        default="floorplan-9fxye/1",
        alias="ROBOFLOW_ROOM_MODEL_ID",
    )
    roboflow_conf: float = Field(default=0.25, alias="ROBOFLOW_CONF")
    # Optional path to cached ONNX/PT (default: models/roboflow_cache/.../weights.onnx)
    roboflow_weights: str = Field(default="", alias="ROBOFLOW_WEIGHTS")
    roboflow_wall_weights: str = Field(default="", alias="ROBOFLOW_WALL_WEIGHTS")
    roboflow_room_weights: str = Field(default="", alias="ROBOFLOW_ROOM_WEIGHTS")
    roboflow_floorplan_seg_model_id: str = Field(
        default="floorplan-segmentation-imdze/4",
        alias="ROBOFLOW_FLOORPLAN_SEG_MODEL_ID",
    )
    roboflow_floorplan_seg_weights: str = Field(
        default="",
        alias="ROBOFLOW_FLOORPLAN_SEG_WEIGHTS",
    )
    # Runtime opening specialist: architect | roboflow-seg (set by detect token)
    opening_backend: str = ""

    @model_validator(mode="after")
    def _resolve_device(self) -> Self:
        resolved = resolve_device(self.device)
        if resolved != self.device:
            object.__setattr__(self, "device", resolved)
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
