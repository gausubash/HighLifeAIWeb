from __future__ import annotations

from pathlib import Path

from app.config import Settings
from app.yolo.wall_registry import (
    default_legacy_wall_path,
    legacy_wall_catalog,
    legacy_wall_ready,
    resolve_legacy_wall_weights,
    resolve_legacy_wall_weights_for_backend,
)


def test_default_legacy_wall_paths() -> None:
    assert default_legacy_wall_path("cascade_swin").name == "cascade_swin_latest.pth"
    assert default_legacy_wall_path("faster_rcnn").name == "faster_rcnn_latest.pth"
    assert default_legacy_wall_path("retinanet").name == "retinanet_latest.pth"
    assert default_legacy_wall_path("deeplab").name == "deeplab_walls_best.h5"
    assert default_legacy_wall_path("unet_floordata").name == "unet_walls_best.h5"


def test_legacy_wall_ready_when_file_present(tmp_path: Path) -> None:
    weights = tmp_path / "cascade_swin_latest.pth"
    weights.write_bytes(b"x")

    settings = Settings(
        WALL_BACKEND="cascade_swin",
        WALL_CASCADE_SWIN_WEIGHTS=str(weights),
    )
    assert legacy_wall_ready(settings) is True
    assert resolve_legacy_wall_weights(settings) == str(weights.resolve())


def test_legacy_wall_catalog(tmp_path: Path) -> None:
    faster = tmp_path / "faster_rcnn_latest.pth"
    faster.write_bytes(b"x")
    settings = Settings(
        WALL_BACKEND="faster_rcnn",
        WALL_FASTER_RCNN_WEIGHTS=str(faster),
        WALL_CASCADE_SWIN_WEIGHTS=str(tmp_path / "missing_cascade.pth"),
        WALL_RETINANET_WEIGHTS=str(tmp_path / "missing_retina.pth"),
        FLOORDATA_DEEPLAB_WEIGHTS=str(tmp_path / "missing_deeplab.h5"),
        FLOORDATA_UNET_WEIGHTS=str(tmp_path / "missing_unet.h5"),
    )
    catalog = legacy_wall_catalog(settings)
    assert catalog["faster_rcnn"]["ready"] is True
    assert catalog["faster_rcnn"]["active"] is True
    assert catalog["cascade_swin"]["ready"] is False
    assert resolve_legacy_wall_weights_for_backend(settings, "faster_rcnn") == str(
        faster.resolve()
    )
