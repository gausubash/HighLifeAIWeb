"""Run Google Drive MMDet wall checkpoints via torchvision remapping.

Checkpoints from:
https://drive.google.com/drive/folders/1MgW3Qo-8K4OrHi4ebvYd-81cTqQxwLgz

These are OpenMMLab MMDet training dumps (state_dict + cfg + dataset_meta).
Classes are ``wall`` and ``room``. We remap weights into torchvision detectors
so Detect does not need a full mmdet install (mmengine is only needed to unpickle).
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import numpy as np
import torch
from PIL import Image
from torchvision.models.detection import fasterrcnn_resnet50_fpn, retinanet_resnet50_fpn
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.transforms.functional import to_tensor

from app.config import Settings, get_settings
from app.yolo.wall_registry import (
    LEGACY_WALL_BACKENDS,
    resolve_legacy_wall_weights_for_backend,
)
from app.yolo.predict import DetectedRegion

MMDET_MODEL_IDS = {
    "faster_rcnn": "mmdet-faster-rcnn-r50",
    "retinanet": "mmdet-retinanet-r50",
    "cascade_swin": "mmdet-cascade-rcnn-r101",
}

_models: dict[str, object] = {}
_model_paths: dict[str, str] = {}


def mmdet_wall_ready(settings: Settings | None = None, backend: str | None = None) -> bool:
    settings = settings or get_settings()
    name = (backend or settings.wall_backend or "").strip().lower()
    if name not in LEGACY_WALL_BACKENDS:
        return False
    path = resolve_legacy_wall_weights_for_backend(settings, name)
    return bool(path) and Path(path).is_file()


def _load_checkpoint(path: Path) -> dict:
    try:
        return torch.load(path, map_location="cpu", weights_only=False)
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Loading MMDet checkpoints needs mmengine in the inference venv "
            "(pip install mmengine). Original error: " + str(exc)
        ) from exc


def _strip_prefix(state: dict[str, torch.Tensor], prefix: str = "module.") -> dict[str, torch.Tensor]:
    out: dict[str, torch.Tensor] = {}
    for key, value in state.items():
        out[key[len(prefix) :] if key.startswith(prefix) else key] = value
    return out


def _map_backbone_body(src: dict[str, torch.Tensor], dst: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    mapped: dict[str, torch.Tensor] = {}
    for key, value in src.items():
        if not key.startswith("backbone."):
            continue
        tv = "backbone.body." + key[len("backbone.") :]
        if tv in dst and tuple(dst[tv].shape) == tuple(value.shape):
            mapped[tv] = value
    return mapped


def _map_fpn(src: dict[str, torch.Tensor], dst: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    mapped: dict[str, torch.Tensor] = {}
    for i in range(4):
        for src_key, dst_key in (
            (f"neck.lateral_convs.{i}.conv.weight", f"backbone.fpn.inner_blocks.{i}.0.weight"),
            (f"neck.lateral_convs.{i}.conv.bias", f"backbone.fpn.inner_blocks.{i}.0.bias"),
            (f"neck.fpn_convs.{i}.conv.weight", f"backbone.fpn.layer_blocks.{i}.0.weight"),
            (f"neck.fpn_convs.{i}.conv.bias", f"backbone.fpn.layer_blocks.{i}.0.bias"),
        ):
            if src_key in src and dst_key in dst and tuple(src[src_key].shape) == tuple(dst[dst_key].shape):
                mapped[dst_key] = src[src_key]
    return mapped


def _map_faster_rcnn(src: dict[str, torch.Tensor], dst: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    mapped = {}
    mapped.update(_map_backbone_body(src, dst))
    mapped.update(_map_fpn(src, dst))

    pairs = {
        "rpn_head.rpn_conv.weight": "rpn.head.conv.0.0.weight",
        "rpn_head.rpn_conv.bias": "rpn.head.conv.0.0.bias",
        "rpn_head.rpn_cls.weight": "rpn.head.cls_logits.weight",
        "rpn_head.rpn_cls.bias": "rpn.head.cls_logits.bias",
        "rpn_head.rpn_reg.weight": "rpn.head.bbox_pred.weight",
        "rpn_head.rpn_reg.bias": "rpn.head.bbox_pred.bias",
        "roi_head.bbox_head.shared_fcs.0.weight": "roi_heads.box_head.fc6.weight",
        "roi_head.bbox_head.shared_fcs.0.bias": "roi_heads.box_head.fc6.bias",
        "roi_head.bbox_head.shared_fcs.1.weight": "roi_heads.box_head.fc7.weight",
        "roi_head.bbox_head.shared_fcs.1.bias": "roi_heads.box_head.fc7.bias",
        "roi_head.bbox_head.fc_cls.weight": "roi_heads.box_predictor.cls_score.weight",
        "roi_head.bbox_head.fc_cls.bias": "roi_heads.box_predictor.cls_score.bias",
        "roi_head.bbox_head.fc_reg.weight": "roi_heads.box_predictor.bbox_pred.weight",
        "roi_head.bbox_head.fc_reg.bias": "roi_heads.box_predictor.bbox_pred.bias",
    }
    for src_key, dst_key in pairs.items():
        if src_key in src and dst_key in dst and tuple(src[src_key].shape) == tuple(dst[dst_key].shape):
            mapped[dst_key] = src[src_key]
    return mapped


def _map_cascade_as_faster(
    src: dict[str, torch.Tensor],
    dst: dict[str, torch.Tensor],
    *,
    stage: int = 2,
) -> dict[str, torch.Tensor]:
    """Cascade R-CNN → Faster R-CNN using one cascade stage (default final)."""
    mapped = {}
    mapped.update(_map_backbone_body(src, dst))
    mapped.update(_map_fpn(src, dst))
    pairs = {
        "rpn_head.rpn_conv.weight": "rpn.head.conv.0.0.weight",
        "rpn_head.rpn_conv.bias": "rpn.head.conv.0.0.bias",
        "rpn_head.rpn_cls.weight": "rpn.head.cls_logits.weight",
        "rpn_head.rpn_cls.bias": "rpn.head.cls_logits.bias",
        "rpn_head.rpn_reg.weight": "rpn.head.bbox_pred.weight",
        "rpn_head.rpn_reg.bias": "rpn.head.bbox_pred.bias",
        f"roi_head.bbox_head.{stage}.shared_fcs.0.weight": "roi_heads.box_head.fc6.weight",
        f"roi_head.bbox_head.{stage}.shared_fcs.0.bias": "roi_heads.box_head.fc6.bias",
        f"roi_head.bbox_head.{stage}.shared_fcs.1.weight": "roi_heads.box_head.fc7.weight",
        f"roi_head.bbox_head.{stage}.shared_fcs.1.bias": "roi_heads.box_head.fc7.bias",
        f"roi_head.bbox_head.{stage}.fc_cls.weight": "roi_heads.box_predictor.cls_score.weight",
        f"roi_head.bbox_head.{stage}.fc_cls.bias": "roi_heads.box_predictor.cls_score.bias",
    }
    for src_key, dst_key in pairs.items():
        if src_key in src and dst_key in dst and tuple(src[src_key].shape) == tuple(dst[dst_key].shape):
            mapped[dst_key] = src[src_key]

    # Cascade uses class-agnostic bbox regression (4); torchvision uses class-specific (8).
    reg_w = src.get(f"roi_head.bbox_head.{stage}.fc_reg.weight")
    reg_b = src.get(f"roi_head.bbox_head.{stage}.fc_reg.bias")
    if reg_w is not None and "roi_heads.box_predictor.bbox_pred.weight" in dst:
        target = dst["roi_heads.box_predictor.bbox_pred.weight"]
        if reg_w.shape[0] == 4 and target.shape[0] == 8:
            mapped["roi_heads.box_predictor.bbox_pred.weight"] = torch.cat([reg_w, reg_w], dim=0)
            mapped["roi_heads.box_predictor.bbox_pred.bias"] = torch.cat([reg_b, reg_b], dim=0)
        elif tuple(reg_w.shape) == tuple(target.shape):
            mapped["roi_heads.box_predictor.bbox_pred.weight"] = reg_w
            mapped["roi_heads.box_predictor.bbox_pred.bias"] = reg_b
    return mapped


def _map_retinanet(src: dict[str, torch.Tensor], dst: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    mapped = {}
    mapped.update(_map_backbone_body(src, dst))

    # Torchvision RetinaNet FPN typically starts at C3 (512). MMDet RetinaNet here
    # uses laterals with in_channels 512/1024/2048 → map those onto inner_blocks.
    lateral_pairs = [
        (0, 0),
        (1, 1),
        (2, 2),
    ]
    for src_i, dst_i in lateral_pairs:
        for src_key, dst_key in (
            (f"neck.lateral_convs.{src_i}.conv.weight", f"backbone.fpn.inner_blocks.{dst_i}.0.weight"),
            (f"neck.lateral_convs.{src_i}.conv.bias", f"backbone.fpn.inner_blocks.{dst_i}.0.bias"),
            (f"neck.fpn_convs.{src_i}.conv.weight", f"backbone.fpn.layer_blocks.{dst_i}.0.weight"),
            (f"neck.fpn_convs.{src_i}.conv.bias", f"backbone.fpn.layer_blocks.{dst_i}.0.bias"),
        ):
            if src_key in src and dst_key in dst and tuple(src[src_key].shape) == tuple(dst[dst_key].shape):
                mapped[dst_key] = src[src_key]

    for i in range(4):
        for src_key, dst_key in (
            (f"bbox_head.cls_convs.{i}.conv.weight", f"head.classification_head.conv.{i}.0.weight"),
            (f"bbox_head.cls_convs.{i}.conv.bias", f"head.classification_head.conv.{i}.0.bias"),
            (f"bbox_head.reg_convs.{i}.conv.weight", f"head.regression_head.conv.{i}.0.weight"),
            (f"bbox_head.reg_convs.{i}.conv.bias", f"head.regression_head.conv.{i}.0.bias"),
        ):
            if src_key in src and dst_key in dst and tuple(src[src_key].shape) == tuple(dst[dst_key].shape):
                mapped[dst_key] = src[src_key]

    for src_key, dst_key in (
        ("bbox_head.retina_cls.weight", "head.classification_head.cls_logits.weight"),
        ("bbox_head.retina_cls.bias", "head.classification_head.cls_logits.bias"),
        ("bbox_head.retina_reg.weight", "head.regression_head.bbox_reg.weight"),
        ("bbox_head.retina_reg.bias", "head.regression_head.bbox_reg.bias"),
    ):
        if src_key in src and dst_key in dst and tuple(src[src_key].shape) == tuple(dst[dst_key].shape):
            mapped[dst_key] = src[src_key]
    return mapped


def build_torchvision_faster_rcnn(
    *,
    num_classes: int,
    mmdet_state: dict[str, torch.Tensor] | None = None,
    cascade: bool = False,
):
    """
    Torchvision Faster R-CNN R50-FPN for Studio fine-tune.

    ``num_classes`` is the number of foreground classes (background is added).
    Optional MMDet state warms backbone/RPN/box head from Google Drive dumps.
    Cascade checkpoints are remapped into the Faster R-CNN topology.
    """
    # torchvision expects total classes including background.
    total = max(2, int(num_classes) + 1)
    model = fasterrcnn_resnet50_fpn(weights=None, weights_backbone=None, num_classes=total)
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, total)
    if not mmdet_state:
        return model
    dst = model.state_dict()
    mapped_raw = _map_cascade_as_faster(mmdet_state, dst) if cascade else _map_faster_rcnn(mmdet_state, dst)
    mapped = {
        key: value
        for key, value in mapped_raw.items()
        if key in dst and tuple(value.shape) == tuple(dst[key].shape)
    }
    missing = model.load_state_dict(mapped, strict=False)
    critical_missing = [
        key
        for key in missing.missing_keys
        if key.startswith(("backbone.body.", "rpn.", "roi_heads.box_head."))
    ]
    if len(critical_missing) > 40:
        raise RuntimeError(
            f"Too many unmapped Faster R-CNN weights ({len(critical_missing)} critical missing)."
        )
    return model


def _build_faster_from_mmdet(state: dict[str, torch.Tensor], *, cascade: bool = False):
    # Detect path: wall + room (+ background) = 3 classes total in torchvision terms.
    return build_torchvision_faster_rcnn(num_classes=2, mmdet_state=state, cascade=cascade)

def build_torchvision_retinanet(
    *,
    num_classes: int,
    mmdet_state: dict[str, torch.Tensor] | None = None,
):
    """Torchvision RetinaNet R50-FPN, optionally warmed from the Google Drive MMDet dump."""
    model = retinanet_resnet50_fpn(weights=None, weights_backbone=None, num_classes=num_classes)
    if not mmdet_state:
        return model
    dst = model.state_dict()
    mapped = {
        key: value
        for key, value in _map_retinanet(mmdet_state, dst).items()
        if key in dst and tuple(value.shape) == tuple(dst[key].shape)
    }
    missing = model.load_state_dict(mapped, strict=False)
    critical_missing = [
        key
        for key in missing.missing_keys
        if key.startswith(("backbone.body.", "head.classification_head.conv.", "head.regression_head.conv."))
    ]
    if len(critical_missing) > 40:
        raise RuntimeError(
            f"Too many unmapped RetinaNet weights ({len(critical_missing)} critical missing)."
        )
    return model


def _build_retinanet_from_mmdet(state: dict[str, torch.Tensor]):
    return build_torchvision_retinanet(num_classes=2, mmdet_state=state)


def get_mmdet_wall_model(settings: Settings | None = None, backend: str | None = None):
    settings = settings or get_settings()
    name = (backend or settings.wall_backend or "").strip().lower()
    if name not in LEGACY_WALL_BACKENDS:
        raise ValueError(f"Not an MMDet wall backend: {name}")
    path = Path(resolve_legacy_wall_weights_for_backend(settings, name))
    if not path.is_file():
        raise FileNotFoundError(f"MMDet wall weights missing: {path}")

    cache_key = f"{name}:{path}"
    if cache_key in _models and _model_paths.get(name) == str(path):
        return _models[cache_key]

    ckpt = _load_checkpoint(path)
    state = _strip_prefix(ckpt.get("state_dict") or {})
    if name == "retinanet":
        model = _build_retinanet_from_mmdet(state)
    elif name == "cascade_swin":
        model = _build_faster_from_mmdet(state, cascade=True)
    else:
        model = _build_faster_from_mmdet(state, cascade=False)

    model.eval()
    device = torch.device("cuda" if settings.device.value == "cuda" and torch.cuda.is_available() else "cpu")
    model.to(device)
    _models[cache_key] = model
    _model_paths[name] = str(path)
    return model


def _xyxy_to_region(
    box: np.ndarray,
    score: float,
    label_idx: int,
    *,
    classes: tuple[str, ...],
    source: str,
) -> DetectedRegion | None:
    if label_idx < 0 or label_idx >= len(classes):
        return None
    x1, y1, x2, y2 = [float(v) for v in box]
    if x2 <= x1 or y2 <= y1:
        return None
    label = classes[label_idx]
    polygon = [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
    entity = "wall" if label == "wall" else "space"
    return DetectedRegion(
        id=str(uuid4()),
        type=entity,
        label=label.title() if label != "wall" else "Wall",
        confidence=round(float(score), 4),
        polygon=polygon,
        bbox=(x1, y1, x2 - x1, y2 - y1),
        attributes={
            "roomType": label,
            "label": label.title() if label != "wall" else "Wall",
            "source": source,
        },
    )


def detect_mmdet_walls(
    rgb: np.ndarray,
    *,
    settings: Settings | None = None,
    backend: str | None = None,
) -> list[DetectedRegion]:
    settings = settings or get_settings()
    name = (backend or settings.wall_backend or "").strip().lower()
    model = get_mmdet_wall_model(settings, name)
    device = next(model.parameters()).device
    conf = float(settings.yolo_wall_conf)
    imgsz = int(settings.yolo_wall_imgsz or 896)

    image = Image.fromarray(rgb.astype(np.uint8)).convert("RGB")
    w0, h0 = image.size
    scale = 1.0
    if max(w0, h0) > imgsz:
        scale = imgsz / float(max(w0, h0))
        image = image.resize((max(1, int(w0 * scale)), max(1, int(h0 * scale))), Image.BILINEAR)

    tensor = to_tensor(image).to(device)
    with torch.inference_mode():
        outputs = model([tensor])[0]

    boxes = outputs["boxes"].detach().cpu().numpy()
    scores = outputs["scores"].detach().cpu().numpy()
    labels = outputs["labels"].detach().cpu().numpy()
    classes = ("wall", "room")
    source = MMDET_MODEL_IDS.get(name, name)
    regions: list[DetectedRegion] = []
    inv = 1.0 / scale if scale else 1.0
    for box, score, label in zip(boxes, scores, labels, strict=False):
        if float(score) < conf:
            continue
        # Faster R-CNN: 1=wall, 2=room. RetinaNet: 0=wall, 1=room.
        label_idx = int(label) if name == "retinanet" else int(label) - 1
        scaled = box * inv
        region = _xyxy_to_region(scaled, float(score), label_idx, classes=classes, source=source)
        if region is not None:
            regions.append(region)
    return regions
