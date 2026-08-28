from __future__ import annotations

import zipfile
from pathlib import Path

from app.studio.dataset import (
    assert_base_model,
    count_images,
    extract_dataset_zip,
    parse_class_names,
    prepare_yolo_dataset,
)


def test_parse_class_names() -> None:
    assert parse_class_names("wall, door\nwindow") == ["wall", "door", "window"]


def test_assert_base_model() -> None:
    assert assert_base_model("detect", "") == "yolov8n.pt"
    assert assert_base_model("segment", "yolov8n-seg.pt") == "yolov8n-seg.pt"
    assert assert_base_model("detect", "retinanet_latest.pth") == "retinanet_latest.pth"
    assert assert_base_model("segment", "deeplab_walls_best.h5") == "deeplab_walls_best.h5"
    assert assert_base_model("detect", "unet_walls_best.h5") == "unet_walls_best.h5"
    assert assert_base_model("segment", "simple_walls_best.h5") == "unet_walls_best.h5"


def test_assert_base_model_mismatch() -> None:
    import pytest

    with pytest.raises(ValueError):
        assert_base_model("segment", "yolov8n.pt")
    with pytest.raises(ValueError):
        assert_base_model("detect", "yolov8n-seg.pt")


def _write_yolo_pair(folder: Path, stem: str) -> None:
    from PIL import Image

    Image.new("RGB", (16, 12), (200, 200, 200)).save(folder / f"{stem}.png")
    (folder / f"{stem}.txt").write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")


def test_prepare_flat_dataset(tmp_path: Path) -> None:
    _write_yolo_pair(tmp_path, "a")
    _write_yolo_pair(tmp_path, "b")
    _write_yolo_pair(tmp_path, "c")
    yaml_path = prepare_yolo_dataset(tmp_path, ["wall"])
    assert yaml_path.is_file()
    text = yaml_path.read_text(encoding="utf-8")
    assert "wall" in text
    assert "images/train" in text


def test_prepare_labelme_json_dir(tmp_path: Path) -> None:
    from PIL import Image

    import base64
    from io import BytesIO

    buf = BytesIO()
    Image.new("RGB", (8, 6), (240, 240, 240)).save(buf, format="PNG")
    payload = {
        "shapes": [
            {
                "label": "Bedroom",
                "shape_type": "polygon",
                "points": [[1, 1], [6, 1], [6, 5], [1, 5]],
            }
        ],
        "imagePath": "page.png",
        "imageData": base64.b64encode(buf.getvalue()).decode("ascii"),
        "imageWidth": 8,
        "imageHeight": 6,
    }
    (tmp_path / "21_page.json").write_text(__import__("json").dumps(payload), encoding="utf-8")
    yaml_path = prepare_yolo_dataset(tmp_path, ["Unit", "Bedroom"], task="segment")
    assert yaml_path.is_file()
    assert "Bedroom" in yaml_path.read_text(encoding="utf-8")
    assert list((yaml_path.parent / "labels").rglob("*.txt"))
    assert any((yaml_path.parent / "images" / "val").glob("*.png"))


def test_prepare_labelme_sidecar_png(tmp_path: Path) -> None:
    from PIL import Image

    Image.new("RGB", (8, 6), (240, 240, 240)).save(tmp_path / "page.png")
    payload = {
        "shapes": [
            {
                "label": "Bedroom",
                "shape_type": "polygon",
                "points": [[1, 1], [6, 1], [6, 5], [1, 5]],
            }
        ],
        "imagePath": "page.png",
        "imageData": None,
        "imageWidth": 8,
        "imageHeight": 6,
    }
    (tmp_path / "floor.json").write_text(__import__("json").dumps(payload), encoding="utf-8")
    yaml_path = prepare_yolo_dataset(tmp_path, ["Unit", "Bedroom"], task="segment")
    assert yaml_path.is_file()
    assert "Bedroom" in yaml_path.read_text(encoding="utf-8")


def test_extract_zip_and_count(tmp_path: Path) -> None:
    inner = tmp_path / "pack"
    images = inner / "images"
    labels = inner / "labels"
    images.mkdir(parents=True)
    labels.mkdir()
    from PIL import Image

    Image.new("RGB", (8, 8), (10, 10, 10)).save(images / "one.png")
    (labels / "one.txt").write_text("0 0.5 0.5 0.4 0.4\n", encoding="utf-8")
    zip_path = tmp_path / "ds.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.write(images / "one.png", "pack/images/one.png")
        zf.write(labels / "one.txt", "pack/labels/one.txt")
    extracted = extract_dataset_zip(zip_path.read_bytes(), tmp_path / "out")
    assert count_images(extracted) == 1
    yaml_path = prepare_yolo_dataset(extracted, ["door"])
    assert yaml_path.is_file()
