from __future__ import annotations

import base64
import json
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

import pytest

from app.config import Settings
from app.yolo.classes import CLASS_TO_ID, canonical_label, display_label, entity_type_for
from app.yolo.convert_labelme import convert_labelme_dir
from app.yolo.predict import layout_enabled, regions_from_ultralytics, yolo_ready


def _png_b64(width: int = 8, height: int = 6) -> str:
    buf = BytesIO()
    Image.new("RGB", (width, height), (240, 240, 240)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def test_canonical_label_aliases() -> None:
    assert canonical_label("Living") == "Open Living"
    assert canonical_label("Toilet") == "Bathroom"
    assert canonical_label("Dining Table") is None
    assert CLASS_TO_ID["Bedroom"] == 2


def test_convert_labelme_writes_yolo_seg(tmp_path: Path) -> None:
    src = tmp_path / "labelme"
    src.mkdir()
    payload = {
        "shapes": [
            {
                "label": "Bedroom",
                "shape_type": "polygon",
                "points": [[1, 1], [6, 1], [6, 5], [1, 5]],
            },
            {
                "label": "Dining Table",
                "shape_type": "polygon",
                "points": [[0, 0], [1, 0], [1, 1], [0, 1]],
            },
        ],
        "imagePath": "21_1.png",
        "imageData": _png_b64(),
        "imageWidth": 8,
        "imageHeight": 6,
    }
    (src / "21_1.json").write_text(json.dumps(payload), encoding="utf-8")

    dataset_yaml = tmp_path / "dataset.yaml"
    dataset_yaml.write_text(
        "splits:\n  fold_1:\n    train: [\"B21\"]\n    test: [\"B20\"]\n",
        encoding="utf-8",
    )
    out = tmp_path / "yolo"
    stats = convert_labelme_dir(src, out, fold="fold_1", dataset_yaml=dataset_yaml)
    assert stats.images == 1
    assert stats.train == 1
    assert stats.val == 0
    assert stats.instances == 1
    assert stats.skipped_labels["Dining Table"] == 1
    label_txt = (out / "labels" / "train" / "21_1.txt").read_text(encoding="utf-8").strip()
    assert label_txt.startswith("2 ")
    assert (out / "images" / "train" / "21_1.png").is_file()
    assert (out / "data.yaml").is_file()


class _Arr:
    def __init__(self, data: list) -> None:
        self._data = np.asarray(data)

    def cpu(self) -> "_Arr":
        return self

    def numpy(self) -> np.ndarray:
        return self._data


class _Boxes:
    def __init__(self) -> None:
        self.cls = _Arr([2])
        self.conf = _Arr([0.91])
        self.xyxy = _Arr([[10.0, 20.0, 40.0, 50.0]])

    def __len__(self) -> int:
        return 1


class _Masks:
    xy = [np.array([[10.0, 20.0], [40.0, 20.0], [40.0, 50.0], [10.0, 50.0]], dtype=np.float64)]


class _Result:
    names = {2: "Bedroom"}
    boxes = _Boxes()
    masks = _Masks()


def test_regions_from_ultralytics_masks() -> None:
    regions = regions_from_ultralytics(
        _Result(),
        src_w=100,
        src_h=80,
        target_w=200,
        target_h=160,
    )
    assert len(regions) == 1
    region = regions[0]
    assert region.label == "Bedroom"
    assert region.type == "room"
    assert region.confidence == 0.91
    assert region.polygon[0] == (20.0, 40.0)
    assert region.attributes["source"] == "yolo"


def test_layout_class_mapping() -> None:
    assert entity_type_for("drawing_area") == "main_floorplan"
    assert entity_type_for("legend_block") == "legend"
    assert entity_type_for("title_block") == "title_block"
    assert display_label("drawing_area") == "Drawing area"
    assert entity_type_for("bed") == "room"
    assert entity_type_for("single door") == "door"
    assert entity_type_for("toilet") == "room"


def test_yolo_ready_remote_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "YOLO_WEIGHTS",
        "https://huggingface.co/GreenMap/yolo11x-blueprint-layout-detector/resolve/main/yolo_layout.pt",
    )
    settings = Settings(_env_file=None)
    assert yolo_ready(settings) is True


def test_yolo_ready_missing_local(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("YOLO_WEIGHTS", str(tmp_path / "missing.pt"))
    settings = Settings(_env_file=None)
    assert yolo_ready(settings) is False


def test_layout_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("USE_LAYOUT_DETECTOR", raising=False)
    monkeypatch.delenv("YOLO_WEIGHTS", raising=False)
    settings = Settings(_env_file=None)
    assert settings.use_layout_detector is False
    assert layout_enabled(settings) is False


class _LayoutBoxes:
    def __init__(self) -> None:
        self.cls = _Arr([0, 2])
        self.conf = _Arr([0.97, 0.99])
        self.xyxy = _Arr([[10.0, 10.0, 90.0, 70.0], [5.0, 72.0, 40.0, 78.0]])

    def __len__(self) -> int:
        return 2


class _LayoutResult:
    names = {0: "drawing_area", 1: "legend_block", 2: "title_block"}
    boxes = _LayoutBoxes()
    masks = None


def test_regions_from_ultralytics_layout_boxes() -> None:
    regions = regions_from_ultralytics(
        _LayoutResult(),
        src_w=100,
        src_h=80,
        target_w=100,
        target_h=80,
    )
    assert [r.label for r in regions] == ["Drawing area", "Title block"]
    assert [r.type for r in regions] == ["main_floorplan", "title_block"]
    assert regions[0].polygon == [(10.0, 10.0), (90.0, 10.0), (90.0, 70.0), (10.0, 70.0)]


class _Obb:
    def __init__(self) -> None:
        self.cls = _Arr([0])
        self.conf = _Arr([0.88])
        self.xyxyxyxy = _Arr([[[10.0, 20.0], [40.0, 22.0], [39.0, 28.0], [9.0, 26.0]]])

    def __len__(self) -> int:
        return 1


class _ObbResult:
    names = {0: "wall"}
    boxes = None
    masks = None
    obb = _Obb()


def test_regions_from_ultralytics_wall_obb() -> None:
    regions = regions_from_ultralytics(
        _ObbResult(),
        src_w=100,
        src_h=80,
        target_w=100,
        target_h=80,
    )
    assert len(regions) == 1
    assert regions[0].label == "Wall"
    assert regions[0].type == "wall"
    assert regions[0].polygon == [(10.0, 20.0), (40.0, 22.0), (39.0, 28.0), (9.0, 26.0)]
