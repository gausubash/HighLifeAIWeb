from __future__ import annotations

from fastapi import APIRouter, File, Form, UploadFile

from app.detect.pipeline import detect_page_regions
from app.errors import ApiError
from app.schemas.detect import DetectedRegionOut, DetectResponse
from app.schemas.scene_graph import BoundingBox, Point
from app.storage import MAX_UPLOAD_BYTES

IMAGE_MIME = {"image/png", "image/jpeg", "image/webp"}

router = APIRouter(prefix="/api", tags=["detect"])


@router.post("/detect", response_model=DetectResponse)
async def detect_regions(
    file: UploadFile = File(...),
    originalWidth: int | None = Form(default=None),
    originalHeight: int | None = Form(default=None),
) -> DetectResponse:
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime == "image/jpg":
        mime = "image/jpeg"
    name = file.filename or "page.png"
    if mime not in IMAGE_MIME and not name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        raise ApiError(
            "UNSUPPORTED_MEDIA_TYPE",
            "Detect expects a PNG, JPEG, or WEBP page raster.",
            status_code=415,
            details={"mimeType": mime},
        )

    data = await file.read()
    if not data:
        raise ApiError("EMPTY_FILE", "No image bytes received.", status_code=400)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ApiError("FILE_TOO_LARGE", "File exceeds 80 MB limit.", status_code=413)

    try:
        result = detect_page_regions(
            data,
            original_width=originalWidth,
            original_height=originalHeight,
        )
    except Exception as exc:
        raise ApiError(
            "DETECT_FAILED",
            "Could not classify regions on this page.",
            status_code=422,
            details={"reason": str(exc)},
        ) from exc

    return DetectResponse(
        modelId=result.model_id,
        modelVersion=result.model_version,
        widthPx=result.width_px,
        heightPx=result.height_px,
        warning=result.warning,
        regions=[
            DetectedRegionOut(
                id=region.id,
                type=region.type,
                label=region.label,
                confidence=region.confidence,
                polygonPx=[Point(x=x, y=y) for x, y in region.polygon],
                bboxPx=BoundingBox(
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
