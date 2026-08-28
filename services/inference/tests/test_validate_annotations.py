"""Phase 4 annotation validation."""

from __future__ import annotations

import json
from pathlib import Path

from app.yolo.validate_annotations import validate_labelme_dir


def test_validate_good_labelme(tmp_path: Path) -> None:
    page = {
        "version": "5.0.1",
        "flags": {},
        "shapes": [
            {
                "label": "Bedroom",
                "points": [[10, 10], [110, 10], [110, 90], [10, 90]],
                "shape_type": "polygon",
            }
        ],
        "imagePath": "20_plan.png",
        "imageHeight": 200,
        "imageWidth": 200,
    }
    path = tmp_path / "20_unit.json"
    path.write_text(json.dumps(page), encoding="utf-8")
    report = validate_labelme_dir(tmp_path, fold="fold_1", require_building=True)
    assert report.ok
    assert report.files_checked == 1
    assert "B20" in report.buildings_seen


def test_validate_unknown_label(tmp_path: Path) -> None:
    page = {
        "shapes": [
            {
                "label": "Spaceship",
                "points": [[0, 0], [10, 0], [10, 10]],
                "shape_type": "polygon",
            }
        ],
        "imagePath": "x.png",
    }
    (tmp_path / "anon.json").write_text(json.dumps(page), encoding="utf-8")
    report = validate_labelme_dir(tmp_path)
    assert not report.ok
    assert any(i.code == "UNKNOWN_LABEL" for i in report.errors)


def test_validate_fold_leakage(tmp_path: Path) -> None:
    for stem, label in (("20_a", "Bedroom"), ("21_b", "Bathroom")):
        page = {
            "shapes": [
                {
                    "label": label,
                    "points": [[0, 0], [40, 0], [40, 40], [0, 40]],
                    "shape_type": "polygon",
                }
            ],
            "imagePath": f"{stem}.png",
        }
        (tmp_path / f"{stem}.json").write_text(json.dumps(page), encoding="utf-8")
    report = validate_labelme_dir(tmp_path, fold="fold_1", require_building=True)
    assert not report.ok
    assert any(i.code == "FOLD_LEAKAGE" for i in report.errors)
