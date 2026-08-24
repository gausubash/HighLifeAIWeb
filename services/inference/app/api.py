"""
Inference HTTP API — local / on-station debugging only.

  uvicorn app.api:app --host 127.0.0.1 --port 8000

On RACE (RMIT private GPU workstation), production inference is the queue
worker writing to shared AWS/Supabase storage — not a public API the browser
calls. FastAPI here is for mock/CPU on the laptop, or localhost debug while
logged into the RACE station.
"""

from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.config import get_settings
from app.pipeline.run import run_pipeline
from app.yolo.mitunet import mitunet_ready
from app.yolo.predict import detect_ready, room_enabled, wall_yolo_ready, yolo_ready
from app.yolo.roboflow import roboflow_ready

app = FastAPI(
    title="HighLife Inference API",
    description="Building design policy checks via computer vision / AI.",
    version="0.1.0",
)

# Local-dev CORS. Not used as a public RACE endpoint.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    status: str = "ok"
    run_mode: str
    device: str
    service: str = "inference"
    yolo_ready: bool = False
    yolo_weights: str | None = None
    room_ready: bool = False
    yolo_room_weights: str | None = None
    wall_ready: bool = False
    yolo_wall_weights: str | None = None
    mitunet_ready: bool = False
    mitunet_wall_weights: str | None = None
    wall_backend: str | None = None
    roboflow_ready: bool = False
    roboflow_model_id: str | None = None


class AnalyzeRequest(BaseModel):
    analysis_id: str = Field(..., min_length=1)
    project_id: str = Field(..., min_length=1)
    source_file_name: str = Field(default="plan.pdf")
    # Later: signed storage URL — worker/API downloads from AWS data plane.
    storage_path: str | None = Field(
        default=None,
        description="Object-storage path or signed URL (Phase 3+). Unused in mock.",
    )


class AnalyzeResponse(BaseModel):
    ok: bool = True
    result: dict


class PointOut(BaseModel):
    x: float
    y: float


class BBoxOut(BaseModel):
    x: float
    y: float
    width: float
    height: float


class DetectedRegionOut(BaseModel):
    id: str
    type: str
    label: str
    confidence: float
    polygonPx: list[PointOut]
    bboxPx: BBoxOut
    attributes: dict[str, object] = Field(default_factory=dict)


class DetectResponse(BaseModel):
    modelId: str
    modelVersion: str
    widthPx: int
    heightPx: int
    regions: list[DetectedRegionOut]
    warning: str | None = None
    device: str | None = None


def _error(status: int, code: str, message: str, details: dict | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "details": details or {}}},
    )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    ready = yolo_ready(settings)
    rooms = room_enabled(settings)
    walls = wall_yolo_ready(settings)
    rf = roboflow_ready(settings)
    mitunet = mitunet_ready(settings)
    return HealthResponse(
        run_mode=settings.run_mode.value,
        device=settings.device.value,
        yolo_ready=ready,
        yolo_weights=settings.yolo_weights if ready else None,
        room_ready=rooms,
        yolo_room_weights=settings.yolo_room_weights if rooms else None,
        wall_ready=walls or rf or mitunet,
        yolo_wall_weights=settings.yolo_wall_weights if walls else None,
        mitunet_ready=mitunet,
        mitunet_wall_weights=settings.mitunet_wall_weights if mitunet else None,
        wall_backend=settings.wall_backend,
        roboflow_ready=rf,
        roboflow_model_id=settings.roboflow_model_id if rf else None,
    )


@app.post("/v1/analyze", response_model=AnalyzeResponse)
def analyze(body: AnalyzeRequest) -> AnalyzeResponse:
    """
    Run one analysis (local/debug).

    Mock (laptop): fixture JSON.
    Real (on RACE localhost debug): load weights; prefer the job worker for
    production so the browser never needs inbound access to RACE.
    """
    settings = get_settings()
    try:
        result = run_pipeline(
            analysis_id=body.analysis_id,
            project_id=body.project_id,
            source_file_name=body.source_file_name,
            settings=settings,
        )
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc

    return AnalyzeResponse(result=result.model_dump(mode="json"))


@app.post("/v1/detect")
async def detect(
    file: UploadFile = File(...),
    originalWidth: int | None = Form(default=None),
    originalHeight: int | None = Form(default=None),
):
    """Walls and fixtures on the full page. Layout crop is opt-in (USE_LAYOUT_DETECTOR)."""
    settings = get_settings()
    if settings.use_layout_detector and not yolo_ready(settings):
        return _error(
            503,
            "YOLO_WEIGHTS_MISSING",
            "Layout detector is enabled but YOLO_WEIGHTS is missing. Set a .pt path/URL, "
            "or set USE_LAYOUT_DETECTOR=false to run walls and fixtures on the full page.",
            {"weights": settings.yolo_weights},
        )
    if not detect_ready(settings):
        return _error(
            503,
            "DETECTORS_MISSING",
            "No wall detector is configured. Set WALL_BACKEND=mitunet or YOLO_WALL_WEIGHTS.",
        )

    name = file.filename or "page.png"
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime == "image/jpg":
        mime = "image/jpeg"
    if mime not in {"image/png", "image/jpeg", "image/webp"} and not name.lower().endswith(
        (".png", ".jpg", ".jpeg", ".webp")
    ):
        return _error(415, "UNSUPPORTED_MEDIA_TYPE", "Detect expects a PNG, JPEG, or WEBP page raster.")

    data = await file.read()
    if not data:
        return _error(400, "EMPTY_FILE", "No image bytes received.")

    try:
        from app.yolo.predict import detect_page_regions

        result = detect_page_regions(
            data,
            original_width=originalWidth,
            original_height=originalHeight,
            settings=settings,
        )
    except FileNotFoundError as exc:
        return _error(503, "YOLO_WEIGHTS_MISSING", str(exc))
    except Exception as exc:
        return _error(422, "DETECT_FAILED", "Detection failed on this page.", {"reason": str(exc)})

    return DetectResponse(
        modelId=result.model_id,
        modelVersion=result.model_version,
        widthPx=result.width_px,
        heightPx=result.height_px,
        warning=result.warning,
        device=result.device,
        regions=[
            DetectedRegionOut(
                id=region.id,
                type=region.type,
                label=region.label,
                confidence=region.confidence,
                polygonPx=[PointOut(x=x, y=y) for x, y in region.polygon],
                bboxPx=BBoxOut(
                    x=region.bbox[0],
                    y=region.bbox[1],
                    width=region.bbox[2],
                    height=region.bbox[3],
                ),
                attributes=region.attributes,
            )
            for region in result.regions
        ],
    )
