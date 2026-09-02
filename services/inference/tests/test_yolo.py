from __future__ import annotations

import base64
import json
from io import BytesIO
from pathlib import Path

import numpy as np
import yaml
from PIL import Image

import pytest

from app.config import Settings
from app.yolo.classes import CLASS_TO_ID, canonical_label, display_label, entity_type_for
from app.yolo.convert_labelme import convert_labelme_dir, looks_like_labelme
from app.yolo.predict import detect_page_regions, layout_enabled, regions_from_ultralytics, yolo_ready


def _png_b64(width: int = 8, height: int = 6) -> str:
    buf = BytesIO()
    Image.new("RGB", (width, height), (240, 240, 240)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def test_canonical_label_aliases() -> None:
    assert canonical_label("Living") == "Open Living"
    assert canonical_label("Toilet") == "Bathroom"
    assert canonical_label("Dining Table") is None
    assert CLASS_TO_ID["Bedroom"] == 2


def test_looks_like_labelme_when_image_path_after_large_shapes(tmp_path: Path) -> None:
    """imagePath/imageData sit after shapes[]; head-only sniff used to miss them."""
    shapes = [
        {
            "label": "Bedroom",
            "shape_type": "polygon",
            "points": [[1, 1], [6, 1], [6, 5], [1, 5]],
            "description": "x" * 80,
        }
        for _ in range(80)
    ]
    payload = {
        "version": "5.8.3",
        "flags": {},
        "shapes": shapes,
        "imagePath": "page.png",
        "imageData": None,
        "imageWidth": 8,
        "imageHeight": 6,
    }
    path = tmp_path / "big.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    assert path.stat().st_size > 4096
    assert looks_like_labelme(path)


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
    # Empty val is filled by mirroring one train sample (Ultralytics requires val images).
    assert stats.val == 1
    assert stats.instances == 1
    assert stats.skipped_labels["Dining Table"] == 1
    label_txt = (out / "labels" / "train" / "21_1.txt").read_text(encoding="utf-8").strip()
    assert label_txt.startswith("2 ")
    assert (out / "images" / "train" / "21_1.png").is_file()
    assert (out / "images" / "val" / "21_1.png").is_file()
    assert (out / "data.yaml").is_file()


def test_convert_labelme_single_page_random_split_fills_val(tmp_path: Path) -> None:
    src = tmp_path / "labelme"
    src.mkdir()
    payload = {
        "shapes": [
            {
                "label": "Bedroom",
                "shape_type": "polygon",
                "points": [[1, 1], [6, 1], [6, 5], [1, 5]],
            }
        ],
        "imagePath": "20_1.png",
        "imageData": _png_b64(),
        "imageWidth": 8,
        "imageHeight": 6,
    }
    (src / "20_1.json").write_text(json.dumps(payload), encoding="utf-8")
    out = tmp_path / "yolo"
    stats = convert_labelme_dir(src, out, fold=None, task="segment")
    assert stats.train == 1
    assert stats.val == 1
    assert (out / "images" / "val" / "20_1.png").is_file()


def test_convert_labelme_pose_writes_tip_base(tmp_path: Path) -> None:
    src = tmp_path / "labelme"
    src.mkdir()
    payload = {
        "shapes": [
            {
                "label": "North",
                "shape_type": "rectangle",
                "points": [[0, 0], [10, 20]],
                "flags": {
                    "keypoints": [
                        {"name": "base", "x": 5, "y": 18},
                        {"name": "tip", "x": 5, "y": 2},
                    ]
                },
            }
        ],
        "imagePath": "n1.png",
        "imageData": _png_b64(20, 20),
        "imageWidth": 20,
        "imageHeight": 20,
    }
    (src / "n1.json").write_text(json.dumps(payload), encoding="utf-8")
    out = tmp_path / "yolo"
    stats = convert_labelme_dir(src, out, fold=None, class_names=["North Arrow"], task="pose")
    assert stats.instances == 1
    line = (out / "labels" / "train" / "n1.txt").read_text(encoding="utf-8").strip()
    parts = [float(x) for x in line.split()]
    assert parts[0] == 0
    assert len(parts) == 11
    assert parts[5:8] == pytest.approx([0.25, 0.9, 2.0])
    assert parts[8:11] == pytest.approx([0.25, 0.1, 2.0])
    data = (out / "data.yaml").read_text(encoding="utf-8")
    assert "kpt_shape" in data
    assert "[2, 3]" in data or "- 2" in data


def test_convert_labelme_pose_drops_unused_layout_classes(tmp_path: Path) -> None:
    src = tmp_path / "labelme"
    src.mkdir()
    payload = {
        "shapes": [
            {
                "label": "North Arrow",
                "shape_type": "rectangle",
                "points": [[0, 0], [10, 20]],
                "flags": {
                    "keypoints": [
                        {"name": "base", "x": 5, "y": 18},
                        {"name": "tip", "x": 5, "y": 2},
                    ]
                },
            }
        ],
        "imagePath": "n1.png",
        "imageData": _png_b64(20, 20),
        "imageWidth": 20,
        "imageHeight": 20,
    }
    (src / "n1.json").write_text(json.dumps(payload), encoding="utf-8")
    out = tmp_path / "yolo"
    convert_labelme_dir(
        src,
        out,
        fold=None,
        class_names=[
            "North Arrow",
            "Title block",
            "Drawing area",
            "Legend block",
            "Drawing border",
            "Revision block",
        ],
        task="pose",
    )
    data = yaml.safe_load((out / "data.yaml").read_text(encoding="utf-8"))
    assert list(data["names"].values()) == ["North Arrow"]
    line = (out / "labels" / "train" / "n1.txt").read_text(encoding="utf-8").strip()
    assert line.startswith("0 ")


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
    monkeypatch.setattr(
        "app.yolo.predict.default_weights_path",
        lambda: tmp_path / "missing_cache.pt",
    )
    settings = Settings(_env_file=None)
    # Falls back to the public Hugging Face layout weights URL.
    assert yolo_ready(settings) is True


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


def test_layout_only_detects_whole_page_not_tiles(monkeypatch: pytest.MonkeyPatch) -> None:
    tiled_calls = {"n": 0}
    predict_calls: list[tuple[int, int]] = []

    def fake_maybe_tiled(rgb, **kwargs) -> list:
        tiled_calls["n"] += 1
        return []

    def fake_predict_regions(model, crop_rgb, **kwargs) -> list:
        predict_calls.append(crop_rgb.shape[:2])
        return regions_from_ultralytics(
            _LayoutResult(),
            src_w=crop_rgb.shape[1],
            src_h=crop_rgb.shape[0],
            target_w=crop_rgb.shape[1],
            target_h=crop_rgb.shape[0],
        )

    monkeypatch.setattr("app.yolo.tiling.maybe_tiled_detect", fake_maybe_tiled)
    monkeypatch.setattr("app.yolo.predict._predict_regions", fake_predict_regions)
    monkeypatch.setattr("app.yolo.predict.get_yolo_model", lambda _s: object())
    monkeypatch.setattr(
        "app.yolo.predict._load_rgb",
        lambda _b: np.zeros((2400, 3200, 3), dtype=np.uint8),
    )

    settings = Settings(
        USE_LAYOUT_DETECTOR=True,
        layout_only=True,
        YOLO_WEIGHTS="models/yolo_layout.pt",
    )
    result = detect_page_regions(b"png", settings=settings)

    assert tiled_calls["n"] == 0
    assert predict_calls == [(2400, 3200)]
    assert len(result.regions) == 2
    assert result.model_id == "yolo11x-blueprint-layout-detector"


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
