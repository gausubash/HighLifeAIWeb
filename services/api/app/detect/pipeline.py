from __future__ import annotations

from dataclasses import dataclass, field
from io import BytesIO

import numpy as np
from PIL import Image

from app.config import get_settings
from app.detect.classify import (
    LABEL_TO_ENTITY_TYPE,
    ROOM_TYPE_ATTR,
    RegionClassifier,
    extract_features,
)
from app.detect.regions import ProposedRegion, propose_enclosed_regions
from app.schemas.scene_graph import new_id


@dataclass
class DetectedRegion:
    id: str
    type: str
    label: str
    confidence: float
    polygon: list[tuple[float, float]]
    bbox: tuple[float, float, float, float]
    attributes: dict[str, object] = field(default_factory=dict)


@dataclass
class DetectResult:
    model_id: str
    model_version: str
    width_px: int
    height_px: int
    regions: list[DetectedRegion]
    warning: str | None = None


def _load_rgb(data: bytes) -> np.ndarray:
    image = Image.open(BytesIO(data)).convert("RGB")
    return np.asarray(image)


def _polygon_list(region: ProposedRegion) -> list[tuple[float, float]]:
    pts = region.polygon
    return [(float(x), float(y)) for x, y in pts]


def detect_with_opencv(
    image_bytes: bytes,
    *,
    original_width: int | None = None,
    original_height: int | None = None,
    classifier: RegionClassifier | None = None,
) -> DetectResult:
    rgb = _load_rgb(image_bytes)
    src_h, src_w = rgb.shape[:2]
    target_w = original_width or src_w
    target_h = original_height or src_h
    sx = target_w / src_w if src_w else 1.0
    sy = target_h / src_h if src_h else 1.0

    clf = classifier or RegionClassifier()
    proposals = propose_enclosed_regions(rgb)
    regions: list[DetectedRegion] = []

    for proposal in proposals:
        poly = [(x * sx, y * sy) for x, y in _polygon_list(proposal)]
        x, y, w, h = proposal.bbox
        bbox = (x * sx, y * sy, w * sx, h * sy)
        scaled = ProposedRegion(
            polygon=np.array(poly, dtype=np.float64),
            bbox=bbox,
            area_px=proposal.area_px * sx * sy,
            perimeter_px=proposal.perimeter_px * ((sx + sy) / 2.0),
            mean_gray=proposal.mean_gray,
            ink_density=proposal.ink_density,
        )
        features = extract_features(scaled, page_width=target_w, page_height=target_h)
        label, confidence = clf.predict(features)
        entity_type = LABEL_TO_ENTITY_TYPE.get(label, "room")
        regions.append(
            DetectedRegion(
                id=new_id(),
                type=entity_type,
                label=label,
                confidence=round(confidence, 4),
                polygon=poly,
                bbox=bbox,
                attributes={
                    "roomType": ROOM_TYPE_ATTR.get(label, "default"),
                    "label": label,
                    "source": "model",
                    "areaFrac": round(features.area_frac, 5),
                },
            )
        )

    warning = None
    if not regions:
        warning = (
            "No enclosed regions found. Plans with broken wall loops often need a "
            "trained segmentation model."
        )

    return DetectResult(
        model_id=clf.model_id,
        model_version=clf.model_version,
        width_px=int(target_w),
        height_px=int(target_h),
        regions=regions,
        warning=warning,
    )


def detect_page_regions(
    image_bytes: bytes,
    *,
    original_width: int | None = None,
    original_height: int | None = None,
    classifier: RegionClassifier | None = None,
) -> DetectResult:
    settings = get_settings()
    if settings.detect_backend.lower() == "yolo":
        from app.detect.yolo_client import detect_via_yolo_inference

        return detect_via_yolo_inference(
            image_bytes,
            original_width=original_width,
            original_height=original_height,
        )
    return detect_with_opencv(
        image_bytes,
        original_width=original_width,
        original_height=original_height,
        classifier=classifier,
    )
