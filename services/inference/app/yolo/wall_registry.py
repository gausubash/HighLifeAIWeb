"""Wall detector weight paths and readiness checks.

Legacy MMDet (.pth) — Google Drive:
https://drive.google.com/drive/folders/1MgW3Qo-8K4OrHi4ebvYd-81cTqQxwLgz

TensorFlow floorData (.h5) — https://github.com/Divak-ar/floorData
"""

from __future__ import annotations

from pathlib import Path

from app.config import Settings, get_settings

GOOGLE_DRIVE_WALL_WEIGHTS_URL = (
    "https://drive.google.com/drive/folders/1MgW3Qo-8K4OrHi4ebvYd-81cTqQxwLgz"
)

FLOORDATA_REPO_URL = "https://github.com/Divak-ar/floorData"

LEGACY_WALL_BACKENDS = frozenset({"cascade_swin", "faster_rcnn", "retinanet"})

FLOORDATA_WALL_BACKENDS = frozenset({"deeplab", "floordata", "unet_floordata"})

OPTIONAL_WALL_BACKENDS = LEGACY_WALL_BACKENDS | FLOORDATA_WALL_BACKENDS

_DEFAULT_FILENAMES = {
    "cascade_swin": "cascade_swin_latest.pth",
    "faster_rcnn": "faster_rcnn_latest.pth",
    "retinanet": "retinanet_latest.pth",
    "deeplab": "deeplab_walls_best.h5",
    "floordata": "deeplab_walls_best.h5",
    "unet_floordata": "unet_walls_best.h5",
}

_UNET_ALIASES = ("unet_walls_best.h5", "simple_walls_best.h5")


def inference_root() -> Path:
    return Path(__file__).resolve().parents[2]


def default_legacy_wall_path(backend: str) -> Path:
    name = _DEFAULT_FILENAMES.get(backend, f"{backend}_latest.pth")
    return inference_root() / "models" / name


def _resolve_unet_path(settings: Settings) -> str:
    raw = (settings.floordata_unet_weights or "").strip()
    if raw:
        path = Path(raw)
        if not path.is_absolute():
            path = (inference_root() / path).resolve()
        return str(path)

    models = inference_root() / "models"
    for name in _UNET_ALIASES:
        candidate = models / name
        if candidate.is_file():
            return str(candidate.resolve())
    return str(default_legacy_wall_path("unet_floordata"))


def legacy_wall_backend(settings: Settings | None = None) -> str | None:
    settings = settings or get_settings()
    backend = (settings.wall_backend or "").strip().lower()
    if backend in OPTIONAL_WALL_BACKENDS:
        return backend
    return None


def is_floordata_backend(backend: str) -> bool:
    return backend.strip().lower() in FLOORDATA_WALL_BACKENDS


def resolve_legacy_wall_weights(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    backend = legacy_wall_backend(settings)
    if backend is None:
        return ""

    raw = ""
    if backend == "cascade_swin":
        raw = settings.wall_cascade_swin_weights.strip()
    elif backend == "faster_rcnn":
        raw = settings.wall_faster_rcnn_weights.strip()
    elif backend == "retinanet":
        raw = settings.wall_retinanet_weights.strip()
    elif backend == "unet_floordata":
        return _resolve_unet_path(settings)
    elif backend in FLOORDATA_WALL_BACKENDS:
        raw = settings.floordata_deeplab_weights.strip()

    if not raw:
        return str(default_legacy_wall_path(backend))

    path = Path(raw)
    if not path.is_absolute():
        path = (inference_root() / path).resolve()
    return str(path)


def legacy_wall_ready(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    if legacy_wall_backend(settings) is None:
        return False
    resolved = resolve_legacy_wall_weights(settings)
    return bool(resolved) and Path(resolved).is_file()


def legacy_wall_catalog(settings: Settings | None = None) -> dict[str, dict[str, object]]:
    """All optional wall weight paths and whether each file exists on disk."""
    settings = settings or get_settings()
    active = legacy_wall_backend(settings)
    out: dict[str, dict[str, object]] = {}
    for backend in sorted(OPTIONAL_WALL_BACKENDS):
        path = resolve_legacy_wall_weights_for_backend(settings, backend)
        out[backend] = {
            "path": path,
            "ready": bool(path) and Path(path).is_file(),
            "active": backend == active,
            "framework": "tensorflow" if is_floordata_backend(backend) else "pytorch",
            "source": FLOORDATA_REPO_URL if is_floordata_backend(backend) else GOOGLE_DRIVE_WALL_WEIGHTS_URL,
        }
    return out


def resolve_legacy_wall_weights_for_backend(settings: Settings, backend: str) -> str:
    backend = backend.strip().lower()
    if backend == "cascade_swin":
        raw = settings.wall_cascade_swin_weights.strip()
    elif backend == "faster_rcnn":
        raw = settings.wall_faster_rcnn_weights.strip()
    elif backend == "retinanet":
        raw = settings.wall_retinanet_weights.strip()
    elif backend == "unet_floordata":
        return _resolve_unet_path(settings)
    elif backend in FLOORDATA_WALL_BACKENDS:
        raw = settings.floordata_deeplab_weights.strip()
    else:
        return ""

    if not raw:
        return str(default_legacy_wall_path(backend))

    path = Path(raw)
    if not path.is_absolute():
        path = (inference_root() / path).resolve()
    return str(path)
