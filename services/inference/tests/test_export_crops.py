from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

from app.studio import local_store as store
from app.studio.export_crops import infer_crop_dataset_meta, padded_crop_xyxy, shape_bbox


def _png(width: int = 200, height: int = 160) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (180, 180, 180)).save(buf, format="PNG")
    return buf.getvalue()


def test_shape_bbox_expands_points() -> None:
    box = shape_bbox([[12, 20]])
    assert box is not None
    x0, y0, x1, y1 = box
    assert x1 - x0 == pytest.approx(16)
    assert y1 - y0 == pytest.approx(16)


def test_padded_crop_square_and_clamp() -> None:
    x0, y0, x1, y1 = padded_crop_xyxy(
        80,
        70,
        100,
        80,
        image_w=200,
        image_h=160,
        padding_frac=0,
        min_side=40,
        square=True,
    )
    assert x1 - x0 == 40
    assert y1 - y0 == 40

    edge = padded_crop_xyxy(
        0,
        0,
        8,
        8,
        image_w=50,
        image_h=40,
        padding_frac=0.25,
        min_side=64,
        square=True,
    )
    assert edge[0] == 0 and edge[1] == 0
    assert edge[2] < 50 and edge[3] < 40


def test_infer_north_arrow_category() -> None:
    category, task = infer_crop_dataset_meta(["North Arrow"], "room_types", "segment")
    assert category == "north_arrow"
    assert task == "pose"


def test_export_annotation_crops_by_class(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIGHLIFE_STUDIO_DIR", str(tmp_path))
    source = store.create_dataset(
        name="Building A",
        task="segment",
        class_names=["Bedroom", "North Arrow"],
        category="room_types",
    )
    page = store.add_page(
        source["id"],
        image_bytes=_png(200, 160),
        source_name="L01.png",
        page_number=1,
    )
    store.add_page(
        source["id"],
        image_bytes=_png(200, 160),
        source_name="L02.png",
        page_number=2,
    )
    store.save_labels(
        source["id"],
        page["id"],
        {
            "shapes": [
                {
                    "label": "North Arrow",
                    "shape_type": "rectangle",
                    "points": [[20, 20], [50, 50]],
                },
                {
                    "label": "Bedroom",
                    "shape_type": "polygon",
                    "points": [[80, 20], [180, 20], [180, 140], [80, 140]],
                },
            ]
        },
    )

    result = store.export_annotation_crops(source["id"], class_labels=["North Arrow"])
    assert result["crops_created"] == 1
    assert result["pages_used"] == 1
    assert result["category"] == "north_arrow"
    assert result["task"] == "pose"
    assert result["class_names"] == ["North Arrow"]
    assert result["labeled_count"] == 1
    crop = result["pages"][0]
    assert crop["width_px"] < 200
    assert crop["height_px"] < 160
    labels = store.read_page_labels(result["id"], crop)
    assert labels is not None
    assert labels["shapes"][0]["label"] == "North Arrow"
    xs = [p[0] for p in labels["shapes"][0]["points"]]
    ys = [p[1] for p in labels["shapes"][0]["points"]]
    assert min(xs) >= 0
    assert min(ys) >= 0
    assert max(xs) <= crop["width_px"]
    assert max(ys) <= crop["height_px"]


def test_export_annotation_crops_from_selection(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIGHLIFE_STUDIO_DIR", str(tmp_path))
    source = store.create_dataset(name="Mixed", task="detect", class_names=["Window", "North Arrow"])
    page = store.add_page(
        source["id"],
        image_bytes=_png(120, 100),
        source_name="sheet.png",
        page_number=1,
    )
    result = store.export_annotation_crops(
        source["id"],
        selections=[
            {
                "pageId": page["id"],
                "label": "North Arrow",
                "points": [[8, 8], [28, 28]],
                "shapeType": "rectangle",
            }
        ],
    )
    assert result["crops_created"] == 1
    assert result["class_names"] == ["North Arrow"]
