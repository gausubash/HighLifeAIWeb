"""
Inference HTTP API — local / on-station debugging only.

  uvicorn app.api:app --host 127.0.0.1 --port 8000

On RACE (RMIT private GPU workstation), production inference is the queue
worker writing to shared AWS/Supabase storage — not a public API the browser
calls. FastAPI here is for mock/CPU on the laptop, or localhost debug while
logged into the RACE station.
"""

from __future__ import annotations

import asyncio
import json
import threading
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.config import get_settings
from app.detect_catalog import (
    WALL_BACKEND,
    default_detect_model,
    list_detect_models,
)
from app.detect_run import run_detect, serialize_detect_result, serialize_region
from app.pipeline.run import run_pipeline
from app.pipeline.room_extract import extract_from_image
from app.yolo.mitunet import mitunet_ready
from app.yolo.predict import resolve_room_weights, room_yolo_ready, wall_yolo_ready, yolo_ready
from app.yolo.roboflow import roboflow_local_ready, roboflow_ready
from app.yolo.tiling import DetectCancelled
from app.yolo.wall_registry import (
    GOOGLE_DRIVE_WALL_WEIGHTS_URL,
    legacy_wall_catalog,
    legacy_wall_ready,
    resolve_legacy_wall_weights,
)

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
    cuda_available: bool = False
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
    legacy_wall_ready: bool = False
    legacy_wall_weights: str | None = None
    legacy_wall_catalog: dict[str, dict[str, object]] | None = None
    wall_weights_source: str | None = None
    roboflow_ready: bool = False
    roboflow_local: bool = False
    roboflow_model_id: str | None = None
    paddle_ocr_ready: bool = False
    paddle_ocr_hint: str | None = None
    paddle_ocr_backend: str | None = None
    paddle_ocr_vl_ready: bool = False


class AnalyzeRequest(BaseModel):
    analysis_id: str = Field(..., min_length=1)
    project_id: str = Field(..., min_length=1)
    source_file_name: str = Field(default="plan.pdf")
    # Later: signed storage URL — worker/API downloads from AWS data plane.
    storage_path: str | None = Field(
        default=None,
        description="Object-storage path or signed URL (Phase 3+). Unused in mock.",
    )
    mm_per_pixel: float | None = Field(default=None)
    calibration_verified: bool = Field(default=False)
    regions: list[dict] | None = Field(
        default=None,
        description="Optional detect regions (from project overlays) for real policy eval.",
    )
    width_px: int | None = None
    height_px: int | None = None
    model_id: str | None = None
    model_version: str | None = None
    entity_statuses: dict[str, str] | None = None
    policy_version: str | None = Field(
        default=None,
        description="Policy pack version (e.g. highlife_v1). Resolves configs/policies/<version>.yaml",
    )


class AnalyzeResponse(BaseModel):
    ok: bool = True
    result: dict
    scene_graph: dict | None = None


def _build_ocr_options(
    *,
    use_doc_orientation_classify: bool,
    use_doc_unwarping: bool,
    use_textline_orientation: bool,
    text_rec_score_thresh: float,
    det_limit_side_len: int | None,
    det_db_thresh: float | None,
    lang: str,
    use_gpu: bool,
    backend: str,
    pipeline_version: str,
    use_layout_detection: bool | None,
    vl_max_side: int | None,
    tile_title_block: bool | None = None,
    tile_drawing: bool | None = None,
) -> dict[str, Any]:
    ocr_options: dict[str, Any] = {
        "use_doc_orientation_classify": bool(use_doc_orientation_classify),
        "use_doc_unwarping": bool(use_doc_unwarping),
        "use_textline_orientation": bool(use_textline_orientation),
        "text_rec_score_thresh": float(text_rec_score_thresh),
        "lang": lang or "en",
        "use_gpu": bool(use_gpu),
        "backend": backend,
    }
    if det_limit_side_len is not None:
        ocr_options["det_limit_side_len"] = int(det_limit_side_len)
    if det_db_thresh is not None:
        ocr_options["det_db_thresh"] = float(det_db_thresh)
    version = (pipeline_version or "").strip()
    if version:
        ocr_options["pipeline_version"] = version
    if use_layout_detection is not None:
        ocr_options["use_layout_detection"] = bool(use_layout_detection)
    if vl_max_side is not None:
        ocr_options["vl_max_side"] = int(vl_max_side)
    if tile_title_block is not None:
        ocr_options["tile_title_block"] = bool(tile_title_block)
    if tile_drawing is not None:
        ocr_options["tile_drawing"] = bool(tile_drawing)
    return ocr_options


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


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    ready = yolo_ready(settings)
    rooms = room_yolo_ready(settings)
    room_weights = resolve_room_weights(settings) if rooms else None
    walls = wall_yolo_ready(settings)
    rf = roboflow_ready(settings)
    rf_local = roboflow_local_ready(settings)
    mitunet = mitunet_ready(settings)
    legacy = legacy_wall_ready(settings)
    from app.pipeline.paddle_ocr import (
        paddle_ocr_available,
        paddle_ocr_hint,
        paddle_ocr_vl_available,
        resolve_ocr_backend,
    )

    paddle_ready = paddle_ocr_available(settings)
    from app.config import torch_cuda_available

    return HealthResponse(
        run_mode=settings.run_mode.value,
        device=settings.device.value,
        cuda_available=torch_cuda_available(),
        yolo_ready=ready,
        yolo_weights=settings.yolo_weights if ready else None,
        room_ready=rooms,
        yolo_room_weights=room_weights,
        wall_ready=walls or rf or mitunet or legacy,
        yolo_wall_weights=settings.yolo_wall_weights if walls else None,
        mitunet_ready=mitunet,
        mitunet_wall_weights=settings.mitunet_wall_weights if mitunet else None,
        wall_backend=settings.wall_backend,
        legacy_wall_ready=legacy,
        legacy_wall_weights=resolve_legacy_wall_weights(settings) if legacy else None,
        legacy_wall_catalog=legacy_wall_catalog(settings),
        wall_weights_source=GOOGLE_DRIVE_WALL_WEIGHTS_URL,
        roboflow_ready=rf,
        roboflow_local=rf_local,
        roboflow_model_id=settings.roboflow_model_id if rf else None,
        paddle_ocr_ready=paddle_ready,
        paddle_ocr_hint=None if paddle_ready else paddle_ocr_hint(settings),
        paddle_ocr_backend=resolve_ocr_backend(settings),
        paddle_ocr_vl_ready=paddle_ocr_vl_available(settings),
    )


@app.get("/v1/policies")
def list_policies() -> dict:
    from app.pipeline.policy_engine import list_policy_packs

    return {"policies": list_policy_packs(), "default": "hooper_apartment_rules_v1"}


class PolicyPageImage(BaseModel):
    pageNumber: int
    image: str


class PolicyFromTextBody(BaseModel):
    text: str = ""
    fileName: str | None = None
    format: str | None = None
    pages: list[PolicyPageImage] | None = None


@app.post("/v1/policy/from-text")
def policy_from_text(body: PolicyFromTextBody) -> dict:
    from app.pipeline.policy_ingest import ingest_policy_text

    try:
        pack, provider = ingest_policy_text(
            body.text,
            file_name=body.fileName,
            fmt=body.format,
            pages=[{"pageNumber": p.pageNumber, "image": p.image} for p in body.pages or []],
        )
    except (ValueError, Exception) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "provider": provider, "pack": pack}


@app.post("/v1/analyze", response_model=AnalyzeResponse)
def analyze(body: AnalyzeRequest) -> AnalyzeResponse:
    """
    Run one analysis (local/debug).

    Mock (laptop): fixture JSON when no regions are supplied.
    Real / with regions: scene graph + design-policy pack evaluation.
    """
    settings = get_settings()
    detect_result = None
    graph = None
    if body.regions is not None:
        from app.pipeline.run import analyze_from_detect
        from app.yolo.predict import DetectResult, DetectedRegion

        regions = []
        for item in body.regions:
            poly = item.get("polygonPx") or item.get("polygon") or []
            polygon = []
            for p in poly:
                if isinstance(p, dict):
                    polygon.append((float(p["x"]), float(p["y"])))
                elif isinstance(p, (list, tuple)) and len(p) >= 2:
                    polygon.append((float(p[0]), float(p[1])))
            bbox = item.get("bboxPx") or item.get("bbox")
            if isinstance(bbox, dict):
                bb = (
                    float(bbox.get("x", 0)),
                    float(bbox.get("y", 0)),
                    float(bbox.get("width", 0)),
                    float(bbox.get("height", 0)),
                )
            elif isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
                bb = (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))
            elif polygon:
                xs = [p[0] for p in polygon]
                ys = [p[1] for p in polygon]
                bb = (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
            else:
                continue
            if len(polygon) < 3:
                x, y, w, h = bb
                polygon = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
            regions.append(
                DetectedRegion(
                    id=str(item.get("id") or uuid4()),
                    type=str(item.get("type") or "other"),
                    label=str(item.get("label") or item.get("type") or "other"),
                    confidence=float(item.get("confidence") or 0.5),
                    polygon=polygon,
                    bbox=bb,
                    attributes=dict(item.get("attributes") or {}),
                )
            )
        detect_result = DetectResult(
            model_id=body.model_id or "overlays",
            model_version=body.model_version or "review",
            width_px=int(body.width_px or 1),
            height_px=int(body.height_px or 1),
            regions=regions,
        )
        result, graph = analyze_from_detect(
            detect_result,
            analysis_id=body.analysis_id,
            project_id=body.project_id,
            source_file_name=body.source_file_name,
            mm_per_pixel=body.mm_per_pixel,
            calibration_verified=body.calibration_verified,
            entity_statuses=body.entity_statuses,
            policy_version=body.policy_version,
            settings=settings,
        )
        return AnalyzeResponse(result=result.model_dump(mode="json"), scene_graph=graph)

    try:
        result = run_pipeline(
            analysis_id=body.analysis_id,
            project_id=body.project_id,
            source_file_name=body.source_file_name,
            settings=settings,
            detect_result=detect_result,
            mm_per_pixel=body.mm_per_pixel,
            calibration_verified=body.calibration_verified,
            entity_statuses=body.entity_statuses,
        )
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc

    return AnalyzeResponse(result=result.model_dump(mode="json"), scene_graph=graph)


@app.post("/v1/ocr/page")
async def ocr_page(
    file: UploadFile = File(...),
    profile: str = Form("default"),
    use_doc_orientation_classify: bool = Form(False),
    use_doc_unwarping: bool = Form(False),
    use_textline_orientation: bool = Form(True),
    text_rec_score_thresh: float = Form(0.5),
    det_limit_side_len: int | None = Form(None),
    det_db_thresh: float | None = Form(None),
    lang: str = Form("en"),
    use_gpu: bool = Form(False),
    backend: str = Form(""),
    pipeline_version: str = Form(""),
    use_layout_detection: bool | None = Form(None),
    vl_max_side: int | None = Form(None),
    tile_title_block: bool | None = Form(None),
    tile_drawing: bool | None = Form(None),
):
    """
    Local PaddleOCR on a page raster.

    ``profile``: ``default`` (title block) or ``dense`` (drawing area — higher det resolution).
    ``backend``: ``classic`` (PP-OCR) or ``vl`` (PaddleOCR-VL 0.9B). Empty uses PADDLE_OCR_BACKEND.
    ``tile_title_block`` / ``tile_drawing``: classic PP-OCR overlapping tiles (both default off).

    Returns parsed sheet metadata (scale, level, title, unit ids) plus raw lines.
    Requires PaddleOCR in .venv-ocr (or PADDLE_OCR_PYTHON) and PADDLE_OCR_ENABLED=true
    (or VLM_PROVIDER=paddleocr with VLM_ENABLED=true).
    """
    from app.pipeline.paddle_ocr import (
        extract_sheet_context_paddle,
        paddle_ocr_available,
        paddle_ocr_hint,
        resolve_ocr_backend,
    )
    from app.yolo.predict import _load_rgb

    settings = get_settings()
    if not (settings.paddle_ocr_enabled or (settings.vlm_enabled and settings.vlm_provider.lower() in {"paddle", "paddleocr", "ocr"})):
        return _error(
            400,
            "OCR_DISABLED",
            "Enable local OCR: set PADDLE_OCR_ENABLED=true and VLM_PROVIDER=paddleocr in services/inference/.env",
        )
    ocr_backend = resolve_ocr_backend(settings, {"backend": backend})
    if not paddle_ocr_available(settings, backend=ocr_backend):
        return _error(503, "OCR_UNAVAILABLE", paddle_ocr_hint(settings, backend=ocr_backend))

    name = file.filename or "page.png"
    data = await file.read()
    if not data:
        return _error(400, "EMPTY_FILE", "No image bytes received.")
    try:
        rgb = _load_rgb(data)
        ocr_profile = "dense" if profile.strip().lower() == "dense" else "default"
        ocr_options = _build_ocr_options(
            use_doc_orientation_classify=use_doc_orientation_classify,
            use_doc_unwarping=use_doc_unwarping,
            use_textline_orientation=use_textline_orientation,
            text_rec_score_thresh=text_rec_score_thresh,
            det_limit_side_len=det_limit_side_len,
            det_db_thresh=det_db_thresh,
            lang=lang,
            use_gpu=use_gpu,
            backend=ocr_backend,
            pipeline_version=pipeline_version,
            use_layout_detection=use_layout_detection,
            vl_max_side=vl_max_side,
            tile_title_block=tile_title_block,
            tile_drawing=tile_drawing,
        )

        meta = extract_sheet_context_paddle(
            rgb,
            settings=settings,
            profile=ocr_profile,
            ocr_options=ocr_options,
        )
    except Exception as exc:
        return _error(500, "OCR_FAILED", str(exc))
    return {
        "ok": True,
        "widthPx": int(rgb.shape[1]),
        "heightPx": int(rgb.shape[0]),
        "sourceFileName": name,
        "sheet": meta,
    }


@app.post("/v1/ocr/page/stream")
async def ocr_page_stream(
    request: Request,
    file: UploadFile = File(...),
    profile: str = Form("default"),
    use_doc_orientation_classify: bool = Form(False),
    use_doc_unwarping: bool = Form(False),
    use_textline_orientation: bool = Form(True),
    text_rec_score_thresh: float = Form(0.5),
    det_limit_side_len: int | None = Form(None),
    det_db_thresh: float | None = Form(None),
    lang: str = Form("en"),
    use_gpu: bool = Form(False),
    backend: str = Form(""),
    pipeline_version: str = Form(""),
    use_layout_detection: bool | None = Form(None),
    vl_max_side: int | None = Form(None),
    tile_title_block: bool | None = Form(None),
    tile_drawing: bool | None = Form(None),
):
    """Same as /v1/ocr/page but streams tile windows as SSE (text/event-stream)."""
    from app.pipeline.paddle_ocr import (
        extract_sheet_context_paddle,
        paddle_ocr_available,
        paddle_ocr_hint,
        resolve_ocr_backend,
    )
    from app.pipeline.paddle_ocr_tiling import OcrCancelled
    from app.yolo.predict import _load_rgb

    settings = get_settings()
    if not (settings.paddle_ocr_enabled or (settings.vlm_enabled and settings.vlm_provider.lower() in {"paddle", "paddleocr", "ocr"})):
        return _error(
            400,
            "OCR_DISABLED",
            "Enable local OCR: set PADDLE_OCR_ENABLED=true and VLM_PROVIDER=paddleocr in services/inference/.env",
        )
    ocr_backend = resolve_ocr_backend(settings, {"backend": backend})
    if not paddle_ocr_available(settings, backend=ocr_backend):
        return _error(503, "OCR_UNAVAILABLE", paddle_ocr_hint(settings, backend=ocr_backend))

    name = file.filename or "page.png"
    data = await file.read()
    if not data:
        return _error(400, "EMPTY_FILE", "No image bytes received.")

    try:
        rgb = _load_rgb(data)
    except Exception as exc:
        return _error(400, "OCR_FAILED", str(exc))

    ocr_profile = "dense" if profile.strip().lower() == "dense" else "default"
    ocr_options = _build_ocr_options(
        use_doc_orientation_classify=use_doc_orientation_classify,
        use_doc_unwarping=use_doc_unwarping,
        use_textline_orientation=use_textline_orientation,
        text_rec_score_thresh=text_rec_score_thresh,
        det_limit_side_len=det_limit_side_len,
        det_db_thresh=det_db_thresh,
        lang=lang,
        use_gpu=use_gpu,
        backend=ocr_backend,
        pipeline_version=pipeline_version,
        use_layout_detection=use_layout_detection,
        vl_max_side=vl_max_side,
        tile_title_block=tile_title_block,
        tile_drawing=tile_drawing,
    )

    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()
    cancel = threading.Event()
    loop = asyncio.get_running_loop()

    def on_progress(kind: str, payload: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, (kind, dict(payload)))

    def worker() -> None:
        try:
            meta = extract_sheet_context_paddle(
                rgb,
                settings=settings,
                profile=ocr_profile,
                ocr_options=ocr_options,
                on_progress=on_progress,
                cancel_check=cancel.is_set,
            )
            loop.call_soon_threadsafe(
                queue.put_nowait,
                (
                    "final",
                    {
                        "ok": True,
                        "widthPx": int(rgb.shape[1]),
                        "heightPx": int(rgb.shape[0]),
                        "sourceFileName": name,
                        "sheet": meta,
                    },
                ),
            )
        except OcrCancelled:
            loop.call_soon_threadsafe(
                queue.put_nowait,
                ("cancelled", {"message": "OCR cancelled"}),
            )
        except Exception as exc:
            loop.call_soon_threadsafe(
                queue.put_nowait,
                ("error", {"code": "OCR_FAILED", "message": str(exc)}),
            )
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    async def event_gen():
        task = asyncio.create_task(asyncio.to_thread(worker))
        try:
            while True:
                if await request.is_disconnected():
                    cancel.set()
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    if cancel.is_set():
                        continue
                    yield _sse("ping", {})
                    continue
                if item is None:
                    break
                event, payload = item
                yield _sse(event, payload)
                if event in {"final", "error", "cancelled"}:
                    while True:
                        rest = await queue.get()
                        if rest is None:
                            break
                    break
        finally:
            cancel.set()
            if not task.done():
                await task

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/v1/ocr/pdf")
async def ocr_pdf(
    file: UploadFile = File(...),
    dpi: int = Form(300),
    page_numbers: str = Form(""),
    page_crops: str = Form(""),
    use_doc_orientation_classify: bool = Form(False),
    use_doc_unwarping: bool = Form(False),
    use_textline_orientation: bool = Form(True),
    text_rec_score_thresh: float = Form(0.5),
    det_limit_side_len: int | None = Form(None),
    det_db_thresh: float | None = Form(None),
    lang: str = Form("en"),
    use_gpu: bool = Form(False),
    backend: str = Form(""),
    pipeline_version: str = Form(""),
    use_layout_detection: bool | None = Form(None),
    vl_max_side: int | None = Form(None),
    tile_title_block: bool | None = Form(None),
    tile_drawing: bool | None = Form(None),
):
    """
    Rasterize PDF pages at ``dpi`` (default 300) and run PaddleOCR on each page.

    ``page_numbers`` is an optional comma-separated 1-based list; when omitted, all pages run.
    ``page_crops`` is optional JSON mapping page numbers to normalized crop boxes
    ``{"1": {"x": 0.7, "y": 0.85, "width": 0.28, "height": 0.12}}`` for title-block OCR.
    ``backend``: ``classic`` or ``vl`` (PaddleOCR-VL). Empty uses PADDLE_OCR_BACKEND.
    """
    import json

    from app.pipeline.paddle_ocr import (
        ocr_pdf_pages,
        paddle_ocr_available,
        paddle_ocr_hint,
        resolve_ocr_backend,
    )

    settings = get_settings()
    if not (settings.paddle_ocr_enabled or (settings.vlm_enabled and settings.vlm_provider.lower() in {"paddle", "paddleocr", "ocr"})):
        return _error(
            400,
            "OCR_DISABLED",
            "Enable local OCR: set PADDLE_OCR_ENABLED=true and VLM_PROVIDER=paddleocr in services/inference/.env",
        )
    ocr_backend = resolve_ocr_backend(settings, {"backend": backend})
    if not paddle_ocr_available(settings, backend=ocr_backend):
        return _error(503, "OCR_UNAVAILABLE", paddle_ocr_hint(settings, backend=ocr_backend))

    name = file.filename or "plan.pdf"
    data = await file.read()
    if not data:
        return _error(400, "EMPTY_FILE", "No PDF bytes received.")
    wanted: list[int] = []
    raw_pages = (page_numbers or "").strip()
    if raw_pages:
        for part in raw_pages.split(","):
            part = part.strip()
            if part.isdigit():
                wanted.append(int(part))
    crops_by_page: dict[int, dict[str, float]] = {}
    raw_crops = (page_crops or "").strip()
    if raw_crops:
        try:
            parsed = json.loads(raw_crops)
            if isinstance(parsed, dict):
                for key, value in parsed.items():
                    page_key = int(key)
                    if page_key < 1 or not isinstance(value, dict):
                        continue
                    box = {
                        k: float(value[k])
                        for k in ("x", "y", "width", "height")
                        if k in value and value[k] is not None
                    }
                    if len(box) == 4:
                        crops_by_page[page_key] = box
        except (TypeError, ValueError, json.JSONDecodeError):
            return _error(400, "INVALID_CROPS", "page_crops must be JSON object keyed by page number.")
    try:
        ocr_options = _build_ocr_options(
            use_doc_orientation_classify=use_doc_orientation_classify,
            use_doc_unwarping=use_doc_unwarping,
            use_textline_orientation=use_textline_orientation,
            text_rec_score_thresh=text_rec_score_thresh,
            det_limit_side_len=det_limit_side_len,
            det_db_thresh=det_db_thresh,
            lang=lang,
            use_gpu=use_gpu,
            backend=ocr_backend,
            pipeline_version=pipeline_version,
            use_layout_detection=use_layout_detection,
            vl_max_side=vl_max_side,
            tile_title_block=tile_title_block,
            tile_drawing=tile_drawing,
        )

        pages = ocr_pdf_pages(
            data,
            dpi=max(72, int(dpi)),
            page_numbers=wanted or None,
            page_crops=crops_by_page or None,
            settings=settings,
            ocr_options=ocr_options,
        )
    except Exception as exc:
        return _error(500, "OCR_FAILED", str(exc))
    return {
        "ok": True,
        "dpi": max(72, int(dpi)),
        "sourceFileName": name,
        "pages": pages,
    }


@app.get("/v1/detect/models")
def detect_models() -> dict:
    """Models the user can pick for Detect (wall / room / object tasks + Studio fine-tunes)."""
    settings = get_settings()
    models = list_detect_models(settings)
    return {
        "models": models,
        "default": default_detect_model(settings),
        "wall_backend": WALL_BACKEND,
    }


def _parse_drawing_crop(raw: str | None) -> dict[str, float] | None:
    if not raw or not str(raw).strip():
        return None
    try:
        import json

        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    try:
        x = float(parsed["x"])
        y = float(parsed["y"])
        width = float(parsed["width"])
        height = float(parsed["height"])
    except (KeyError, TypeError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    return {"x": x, "y": y, "width": width, "height": height}


def _parse_json_list(raw: str) -> list | None:
    if not raw or not str(raw).strip():
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, list) else None


@app.post("/v1/detect")
async def detect(
    file: UploadFile = File(...),
    originalWidth: int | None = Form(default=None),
    originalHeight: int | None = Form(default=None),
    modelId: str | None = Form(default=None),
    detectModel: str | None = Form(default=None),
    drawingCrop: str = Form(""),
    tileWalls: str = Form(""),
    wallImgsz: str = Form(""),
    wallThreshold: str = Form(""),
    tileOverlap: str = Form(""),
):
    """Walls/fixtures on the full page, or a selected wall backend / Studio model."""
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
        result = run_detect(
            data,
            original_width=originalWidth,
            original_height=originalHeight,
            detect_model=detectModel,
            model_id=modelId,
            drawing_crop=_parse_drawing_crop(drawingCrop),
            tile_walls=tileWalls,
            wall_imgsz=wallImgsz,
            wall_threshold=wallThreshold,
            tile_overlap=tileOverlap,
        )
    except HTTPException:
        raise
    except FileNotFoundError as exc:
        return _error(503, "YOLO_WEIGHTS_MISSING", str(exc))
    except Exception as exc:
        return _error(422, "DETECT_FAILED", "Detection failed on this page.", {"reason": str(exc)})

    if isinstance(result, JSONResponse):
        return result

    body = serialize_detect_result(result)
    return DetectResponse(
        modelId=body["modelId"],
        modelVersion=body["modelVersion"],
        widthPx=body["widthPx"],
        heightPx=body["heightPx"],
        warning=body["warning"],
        device=body.get("device"),
        regions=[
            DetectedRegionOut(
                id=region["id"],
                type=region["type"],
                label=region["label"],
                confidence=region["confidence"],
                polygonPx=[PointOut(x=p["x"], y=p["y"]) for p in region["polygonPx"]],
                bboxPx=BBoxOut(
                    x=region["bboxPx"]["x"],
                    y=region["bboxPx"]["y"],
                    width=region["bboxPx"]["width"],
                    height=region["bboxPx"]["height"],
                ),
                attributes=region.get("attributes") or {},
            )
            for region in body["regions"]
        ],
    )


@app.post("/v1/geometry/extract", response_model=DetectResponse)
async def geometry_extract(
    file: UploadFile = File(...),
    originalWidth: int | None = Form(default=None),
    originalHeight: int | None = Form(default=None),
    unitPolygons: str = Form(""),
    openings: str = Form(""),
):
    """Per-unit wall-bounded rooms. Composes existing wall/room predict; Detect is unchanged."""
    name = file.filename or "page.png"
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime == "image/jpg":
        mime = "image/jpeg"
    if mime not in {"image/png", "image/jpeg", "image/webp"} and not name.lower().endswith(
        (".png", ".jpg", ".jpeg", ".webp")
    ):
        return _error(415, "UNSUPPORTED_MEDIA_TYPE", "Geometry extract expects a PNG, JPEG, or WEBP page raster.")

    data = await file.read()
    if not data:
        return _error(400, "EMPTY_FILE", "No image bytes received.")

    try:
        regions, width_px, height_px, warning = extract_from_image(
            data,
            original_width=originalWidth,
            original_height=originalHeight,
            unit_polygons=_parse_json_list(unitPolygons),
            openings=_parse_json_list(openings),
        )
    except FileNotFoundError as exc:
        return _error(503, "GEOMETRY_WEIGHTS_MISSING", str(exc))
    except Exception as exc:
        return _error(422, "GEOMETRY_EXTRACT_FAILED", "Geometry extract failed on this page.", {"reason": str(exc)})

    serialized = [serialize_region(r) for r in regions]
    return DetectResponse(
        modelId="geometry:wall_bounded",
        modelVersion="0.1.0",
        widthPx=width_px,
        heightPx=height_px,
        warning=warning,
        device=None,
        regions=[
            DetectedRegionOut(
                id=region["id"],
                type=region["type"],
                label=region["label"],
                confidence=region["confidence"],
                polygonPx=[PointOut(x=p["x"], y=p["y"]) for p in region["polygonPx"]],
                bboxPx=BBoxOut(
                    x=region["bboxPx"]["x"],
                    y=region["bboxPx"]["y"],
                    width=region["bboxPx"]["width"],
                    height=region["bboxPx"]["height"],
                ),
                attributes=region.get("attributes") or {},
            )
            for region in serialized
        ],
    )


@app.post("/v1/detect/stream")
async def detect_stream(
    request: Request,
    file: UploadFile = File(...),
    originalWidth: int | None = Form(default=None),
    originalHeight: int | None = Form(default=None),
    modelId: str | None = Form(default=None),
    detectModel: str | None = Form(default=None),
    drawingCrop: str = Form(""),
    tileWalls: str = Form(""),
    wallImgsz: str = Form(""),
    wallThreshold: str = Form(""),
    tileOverlap: str = Form(""),
):
    """Same as /v1/detect but streams tile progress as SSE (text/event-stream)."""
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

    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()
    cancel = threading.Event()
    loop = asyncio.get_running_loop()

    def on_progress(kind: str, payload: dict[str, Any]) -> None:
        out = dict(payload)
        regions = out.get("regions")
        if isinstance(regions, list) and regions and hasattr(regions[0], "bbox"):
            out["regions"] = [serialize_region(r) for r in regions]
        loop.call_soon_threadsafe(queue.put_nowait, (kind, out))

    def worker() -> None:
        try:
            result = run_detect(
                data,
                original_width=originalWidth,
                original_height=originalHeight,
                detect_model=detectModel,
                model_id=modelId,
                drawing_crop=_parse_drawing_crop(drawingCrop),
                tile_walls=tileWalls,
                wall_imgsz=wallImgsz,
                wall_threshold=wallThreshold,
                tile_overlap=tileOverlap,
                on_progress=on_progress,
                cancel_check=cancel.is_set,
            )
            if isinstance(result, JSONResponse):
                body = result.body
                parsed = json.loads(body.decode("utf-8") if isinstance(body, (bytes, bytearray)) else body)
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    ("error", parsed.get("error") or {"code": "DETECT_FAILED", "message": "Detect failed"}),
                )
            else:
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    ("final", serialize_detect_result(result)),
                )
        except DetectCancelled:
            loop.call_soon_threadsafe(
                queue.put_nowait,
                ("cancelled", {"message": "Detection cancelled"}),
            )
        except FileNotFoundError as exc:
            loop.call_soon_threadsafe(
                queue.put_nowait,
                ("error", {"code": "YOLO_WEIGHTS_MISSING", "message": str(exc)}),
            )
        except Exception as exc:
            loop.call_soon_threadsafe(
                queue.put_nowait,
                ("error", {"code": "DETECT_FAILED", "message": str(exc)}),
            )
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    async def event_gen():
        task = asyncio.create_task(asyncio.to_thread(worker))
        try:
            while True:
                if await request.is_disconnected():
                    cancel.set()
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    if cancel.is_set():
                        continue
                    yield _sse("ping", {})
                    continue
                if item is None:
                    break
                event, payload = item
                yield _sse(event, payload)
                if event in {"final", "error", "cancelled"}:
                    # Drain until worker finishes, then end the stream immediately.
                    while True:
                        rest = await queue.get()
                        if rest is None:
                            break
                    break
        finally:
            cancel.set()
            if not task.done():
                await task

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


from app.studio.http import router as studio_router

app.include_router(studio_router)
