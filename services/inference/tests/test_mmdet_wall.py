from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.config import Settings
from app.yolo.mmdet_wall import detect_mmdet_walls, get_mmdet_wall_model, mmdet_wall_ready


@pytest.mark.parametrize("backend", ["faster_rcnn", "retinanet", "cascade_swin"])
def test_mmdet_wall_model_loads(backend: str) -> None:
    root = Path(__file__).resolve().parents[1]
    weights = root / "models" / {
        "faster_rcnn": "faster_rcnn_latest.pth",
        "retinanet": "retinanet_latest.pth",
        "cascade_swin": "cascade_swin_latest.pth",
    }[backend]
    if not weights.is_file():
        pytest.skip(f"weights missing: {weights}")

    settings = Settings(
        WALL_BACKEND=backend,
        WALL_CASCADE_SWIN_WEIGHTS=str(root / "models" / "cascade_swin_latest.pth"),
        WALL_FASTER_RCNN_WEIGHTS=str(root / "models" / "faster_rcnn_latest.pth"),
        WALL_RETINANET_WEIGHTS=str(root / "models" / "retinanet_latest.pth"),
        USE_LAYOUT_DETECTOR=False,
        USE_ROOM_DETECTOR=False,
    )
    assert mmdet_wall_ready(settings, backend)
    model = get_mmdet_wall_model(settings, backend)
    assert model is not None

    rgb = np.full((256, 256, 3), 255, dtype=np.uint8)
    regions = detect_mmdet_walls(rgb, settings=settings, backend=backend)
    assert isinstance(regions, list)
