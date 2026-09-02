from __future__ import annotations

from pathlib import Path

from PIL import Image

from app.studio.train_monitor import (
    list_preview_epochs,
    list_training_plots,
    record_epoch_preview,
    resolve_epoch_preview,
    write_gt_overlay,
)


def test_record_and_resolve_epoch_previews(tmp_path: Path) -> None:
    preview = tmp_path / "preview.png"
    Image.new("RGB", (8, 6), (10, 20, 30)).save(preview)
    assert record_epoch_preview(preview, 1) == [1]
    Image.new("RGB", (8, 6), (200, 0, 0)).save(preview)
    assert record_epoch_preview(preview, 3) == [1, 3]
    ep1 = resolve_epoch_preview(tmp_path, 1)
    assert ep1 is not None and ep1.name == "ep_001.png"
    nearest = resolve_epoch_preview(tmp_path, 2)
    assert nearest is not None and nearest.name == "ep_001.png"
    latest = resolve_epoch_preview(tmp_path, None)
    assert latest == preview


def test_write_gt_overlay_boxes_and_polygons(tmp_path: Path) -> None:
    images = tmp_path / "images" / "val"
    labels = tmp_path / "labels" / "val"
    images.mkdir(parents=True)
    labels.mkdir(parents=True)
    sample = images / "page.png"
    Image.new("RGB", (100, 50), (240, 240, 240)).save(sample)
    (labels / "page.txt").write_text("0 0.5 0.5 0.4 0.4\n1 0.1 0.1 0.2 0.1 0.2 0.3 0.1 0.3\n", encoding="utf-8")
    out = tmp_path / "previews" / "gt.png"
    assert write_gt_overlay(sample, out) is True
    assert out.is_file()
    assert Image.open(out).size == (100, 50)


def test_list_training_plots(tmp_path: Path) -> None:
    runs = tmp_path / "runs" / "job-abc"
    runs.mkdir(parents=True)
    (runs / "results.png").write_bytes(b"png")
    (runs / "confusion_matrix.png").write_bytes(b"png")
    (runs / "secret.bin").write_bytes(b"no")
    plots = list_training_plots(tmp_path)
    assert [item["id"] for item in plots] == ["results.png", "confusion_matrix.png"]
    assert list_preview_epochs(tmp_path) == []
