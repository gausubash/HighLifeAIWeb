"""MitUNet wall segmentation (Mix-Transformer B4 encoder + U-Net + scSE).

Checkpoint: https://github.com/aliasstudio/mitunet
Paper: https://arxiv.org/abs/2512.02413
"""

from __future__ import annotations

import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

from app.config import Settings, get_settings, runtime_torch_device

MITUNET_WALL_URL = (
    "https://media.githubusercontent.com/media/aliasstudio/mitunet/master/"
    "experiments/models/mitunet_finetune_a6_mit_b4_tversky_8864_28E.pth"
)
MITUNET_MODEL_ID = "mitunet-mit-b4-walls"
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
MIN_WEIGHTS_BYTES = 200_000_000

_model = None
_model_path: str | None = None


def default_mitunet_path() -> Path:
    return Path(__file__).resolve().parents[2] / "models" / "mitunet_walls.pth"


def is_remote_url(value: str) -> bool:
    return value.strip().startswith(("http://", "https://"))


def resolve_mitunet_weights(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    raw = (settings.mitunet_wall_weights or "").strip()
    if not raw:
        return ""
    cache = default_mitunet_path()
    if is_remote_url(raw):
        if cache.is_file() and cache.stat().st_size >= MIN_WEIGHTS_BYTES:
            return str(cache)
        return raw
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parents[2] / path).resolve()
    return str(path)


def mitunet_ready(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    raw = (settings.mitunet_wall_weights or "").strip()
    if not raw:
        return False
    backend = (settings.wall_backend or "mitunet").strip().lower()
    if backend == "yolo":
        return False
    from app.yolo.wall_registry import OPTIONAL_WALL_BACKENDS

    if backend in OPTIONAL_WALL_BACKENDS:
        return False
    if is_remote_url(raw):
        return True
    path = Path(resolve_mitunet_weights(settings))
    return path.is_file() and path.stat().st_size >= MIN_WEIGHTS_BYTES


def ensure_mitunet_weights(settings: Settings | None = None) -> Path:
    settings = settings or get_settings()
    resolved = resolve_mitunet_weights(settings)
    if not resolved:
        raise FileNotFoundError("MITUNET_WALL_WEIGHTS is empty.")
    if not is_remote_url(resolved):
        path = Path(resolved)
        if not path.is_file() or path.stat().st_size < MIN_WEIGHTS_BYTES:
            raise FileNotFoundError(f"MitUNet weights not found at {path}")
        return path

    dest = default_mitunet_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and dest.stat().st_size >= MIN_WEIGHTS_BYTES:
        return dest

    tmp = dest.with_suffix(".pth.download")
    request = urllib.request.Request(resolved, headers={"User-Agent": "HighLifeAIWeb"})
    with urllib.request.urlopen(request, timeout=600) as response, tmp.open("wb") as handle:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)
    if tmp.stat().st_size < MIN_WEIGHTS_BYTES:
        tmp.unlink(missing_ok=True)
        raise FileNotFoundError(f"MitUNet download was too small: {resolved}")
    tmp.replace(dest)
    return dest


def mask_to_polygons(
    mask: np.ndarray,
    *,
    min_area: int = 24,
    max_vertices: int = 80,
) -> list[np.ndarray]:
    """Binary mask (H, W) → list of (N, 2) polygons in the same pixel space."""
    binary = (mask > 0).astype(np.uint8)
    if int(binary.max()) == 0:
        return []
    try:
        import cv2
    except ImportError:
        ys, xs = np.where(binary)
        if xs.size < min_area:
            return []
        x0, x1 = float(xs.min()), float(xs.max()) + 1.0
        y0, y1 = float(ys.min()), float(ys.max()) + 1.0
        return [np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dtype=np.float64)]

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polygons: list[np.ndarray] = []
    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < min_area:
            continue
        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, max(1.0, 0.002 * peri), True)
        pts = approx.reshape(-1, 2).astype(np.float64)
        if pts.shape[0] < 3:
            continue
        if pts.shape[0] > max_vertices:
            step = int(np.ceil(pts.shape[0] / max_vertices))
            pts = pts[::step]
        polygons.append(pts)
    return polygons


def _build_model():
    import segmentation_models_pytorch as smp

    aux = smp.Segformer(encoder_name="mit_b4", encoder_weights=None)
    model = smp.Unet(
        encoder_name="mit_b4",
        encoder_weights=None,
        in_channels=3,
        classes=1,
        decoder_attention_type="scse",
    )
    model.encoder = aux.encoder
    return model


def _unwrap_state_dict(raw: object) -> dict:
    if not isinstance(raw, dict):
        raise TypeError("MitUNet checkpoint is not a state dict")
    if "state_dict" in raw and isinstance(raw["state_dict"], dict):
        raw = raw["state_dict"]
    if not raw:
        raise TypeError("MitUNet checkpoint is empty")
    if any(not isinstance(key, str) for key in raw):
        return raw  # type: ignore[return-value]
    if any(key.startswith("module.") for key in raw):
        return {key.removeprefix("module."): value for key, value in raw.items()}
    return raw


def get_mitunet_model(settings: Settings | None = None):
    global _model, _model_path
    settings = settings or get_settings()
    path = ensure_mitunet_weights(settings)
    key = str(path)
    if _model is not None and _model_path == key:
        return _model

    import torch

    model = _build_model()
    raw = torch.load(path, map_location="cpu", weights_only=False)
    model.load_state_dict(_unwrap_state_dict(raw))
    model.eval()
    device = runtime_torch_device(settings)
    model.to(device)
    _model = model
    _model_path = key
    return model


def predict_wall_mask(rgb: np.ndarray, settings: Settings | None = None) -> np.ndarray:
    """Return a float mask in crop pixel space, values in [0, 1]."""
    import torch

    from app.yolo.letterbox import letterbox_rgb, unletterbox_mask

    settings = settings or get_settings()
    model = get_mitunet_model(settings)
    size = max(32, int(settings.mitunet_wall_imgsz))
    canvas, scale, ox, oy, orig_hw = letterbox_rgb(rgb, size, fill=255, center=True)
    array = canvas.astype(np.float32) / 255.0
    array = (array - IMAGENET_MEAN) / IMAGENET_STD
    tensor = torch.from_numpy(np.transpose(array, (2, 0, 1))).unsqueeze(0)
    tensor = tensor.to(runtime_torch_device(settings))
    with torch.no_grad():
        logits = model(tensor)
        probs = torch.sigmoid(logits)[0, 0].detach().cpu().numpy()
    if probs.shape[0] != size or probs.shape[1] != size:
        probs = np.asarray(
            Image.fromarray(probs.astype(np.float32), mode="F").resize((size, size), Image.BILINEAR),
            dtype=np.float32,
        )
    return unletterbox_mask(
        probs,
        scale=scale,
        offset_x=ox,
        offset_y=oy,
        orig_hw=orig_hw,
        canvas_size=size,
    )


def wall_polygons_from_rgb(
    rgb: np.ndarray,
    settings: Settings | None = None,
) -> tuple[list[list[tuple[float, float]]], float]:
    settings = settings or get_settings()
    probs = predict_wall_mask(rgb, settings)
    threshold = float(settings.mitunet_wall_threshold)
    binary = probs >= threshold
    if not np.any(binary):
        return [], 0.0
    confidence = float(np.clip(probs[binary].mean(), 0.0, 1.0))
    min_area = max(16, int(0.0002 * rgb.shape[0] * rgb.shape[1]))
    polygons = mask_to_polygons(binary.astype(np.uint8), min_area=min_area, max_vertices=80)
    out = [[(float(x), float(y)) for x, y in poly] for poly in polygons]
    return out, confidence
