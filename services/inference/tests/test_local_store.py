from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

from app.studio import local_store as store


def _png(width: int = 8, height: int = 6) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (200, 200, 200)).save(buf, format="PNG")
    return buf.getvalue()


def test_local_dataset_pages_and_labels(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIGHLIFE_STUDIO_DIR", str(tmp_path))
    dataset = store.create_dataset(name="B20", task="segment", class_names=["Bedroom", "Wall"])
    page = store.add_page(
        dataset["id"],
        image_bytes=_png(),
        source_name="plan.pdf",
        page_number=1,
    )
    assert page["width_px"] == 8
    saved = store.save_labels(
        dataset["id"],
        page["id"],
        {
            "shapes": [
                {
                    "label": "Bedroom",
                    "shape_type": "polygon",
                    "points": [[1, 1], [6, 1], [6, 5], [1, 5]],
                }
            ]
        },
    )
    assert saved["labeled"] is True
    assert saved["shape_count"] == 1
    listed = store.list_datasets()
    assert listed[0]["labeled_count"] == 1
    json_path = store.page_json_path(dataset["id"], page["id"])
    assert json_path.is_file()
    store.save_labels(dataset["id"], page["id"], {"shapes": []})
    assert not json_path.is_file()


def test_train_refuses_unlabeled_dataset(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIGHLIFE_STUDIO_DIR", str(tmp_path))
    dataset = store.create_dataset(name="empty", task="segment", class_names=["Bedroom"])
    store.add_page(dataset["id"], image_bytes=_png(), source_name="a.pdf", page_number=1)
    with pytest.raises(store.StudioStoreError):
        store.labeled_pages_dir(dataset["id"])


def test_delete_page_and_unlink_source(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIGHLIFE_STUDIO_DIR", str(tmp_path))
    dataset = store.create_dataset(name="B20", task="segment", class_names=["Bedroom"])
    page_a = store.add_page(
        dataset["id"], image_bytes=_png(), source_name="a.pdf", page_number=1
    )
    page_b = store.add_page(
        dataset["id"], image_bytes=_png(), source_name="b.pdf", page_number=1
    )
    summary = store.delete_page(dataset["id"], page_a["id"])
    assert summary["image_count"] == 1
    assert all(page["id"] != page_a["id"] for page in summary["pages"])

    # Pretend pages are linked from a folder path for unlink matching.
    meta_path = store.dataset_dir(dataset["id"]) / "meta.json"
    meta = store._read_json(meta_path)
    folder = str(tmp_path / "plans")
    for page in meta["pages"]:
        page["source_path"] = str(Path(folder) / page["source_name"])
        page["link"] = True
    meta["linked_paths"] = [folder]
    store._write_json(meta_path, meta)

    unlinked = store.unlink_source(dataset["id"], folder)
    assert unlinked["image_count"] == 0
    assert unlinked["removed_count"] == 1


def test_ingest_uploaded_images(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIGHLIFE_STUDIO_DIR", str(tmp_path))
    dataset = store.create_dataset(name="up", task="segment", class_names=["Bedroom"])
    summary = store.ingest_uploaded_files(
        dataset["id"],
        [("plans/a.png", _png(10, 8)), ("plans/b.jpg", _png(12, 9))],
        split="test",
    )
    assert summary["added_count"] == 2
    assert summary["test_count"] == 2
    assert summary["image_count"] == 2
    assert all(page.get("split") == "test" for page in summary["pages"])


def test_ingest_pdf_converts_at_dpi(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("pypdfium2")
    monkeypatch.setenv("HIGHLIFE_STUDIO_DIR", str(tmp_path))

    # Minimal one-page PDF (blank MediaBox).
    pdf_bytes = b"""%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 150] >>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer<< /Size 4 /Root 1 0 R >>
startxref
190
%%EOF
"""

    dataset = store.create_dataset(name="pdf", task="segment", class_names=["Bedroom"])
    summary = store.ingest_uploaded_files(
        dataset["id"],
        [("plans/plan.pdf", pdf_bytes)],
        split="train",
        dpi=150,
        convert_pdf=True,
    )
    assert summary["added_count"] >= 1
    assert summary["pages"][0]["kind"] == "image"
    assert summary["pages"][0]["dpi"] == 150
    assert summary["pages"][0]["width_px"] > 0
    assert summary["pages"][0]["source_name"] == "plan_1.png"

    keep = store.create_dataset(name="keep", task="segment", class_names=["Bedroom"])
    kept = store.ingest_uploaded_files(
        keep["id"],
        [("plans/plan.pdf", pdf_bytes)],
        convert_pdf=False,
        dpi=200,
    )
    assert kept["pages"][0]["kind"] == "pdf"
    converted = store.convert_dataset_pdfs_to_images(keep["id"], dpi=200)
    assert converted["converted_count"] >= 1
    assert converted["pages"][0]["kind"] == "image"
    assert converted["pages"][0]["source_name"] == "plan_1.png"

def test_convert_dataset_to_yolo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIGHLIFE_STUDIO_DIR", str(tmp_path))
    from app.studio import local_store as store

    dataset = store.create_dataset(name="yolo", task="segment", class_names=["Bedroom", "Wall"])
    page = store.add_page(
        dataset["id"],
        image_bytes=_png(16, 12),
        source_name="20_1.png",
        page_number=1,
    )
    store.save_labels(
        dataset["id"],
        page["id"],
        {
            "shapes": [
                {
                    "label": "Bedroom",
                    "shape_type": "polygon",
                    "points": [[1, 1], [14, 1], [14, 10], [1, 10]],
                },
                {
                    "label": "UnknownThing",
                    "shape_type": "polygon",
                    "points": [[2, 2], [3, 2], [3, 3], [2, 3]],
                },
            ]
        },
    )
    result = store.convert_dataset_to_yolo(dataset["id"])
    assert result["images"] >= 1
    assert result["val"] >= 1
    assert result["skipped_labels"].get("UnknownThing") == 1
    assert (Path(result["path"]) / "data.yaml").is_file()


def test_page_split_filters_training(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIGHLIFE_STUDIO_DIR", str(tmp_path))
    dataset = store.create_dataset(name="split", task="segment", class_names=["Bedroom"])
    page = store.add_page(dataset["id"], image_bytes=_png(), source_name="a.pdf", page_number=1)
    store.save_labels(
        dataset["id"],
        page["id"],
        {
            "shapes": [
                {
                    "label": "Bedroom",
                    "shape_type": "polygon",
                    "points": [[1, 1], [6, 1], [6, 5], [1, 5]],
                }
            ]
        },
    )
    store.set_page_split(dataset["id"], page["id"], "test")
    with pytest.raises(store.StudioStoreError):
        store.labeled_pages_dir(dataset["id"], split="train")
    store.set_page_split(dataset["id"], page["id"], "train")
    out = store.labeled_pages_dir(dataset["id"], split="train")
    assert out.is_dir()


def test_update_dataset_purpose_swaps_task_and_stock_classes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HIGHLIFE_STUDIO_DIR", str(tmp_path))
    dataset = store.create_dataset(
        name="walls",
        task="segment",
        class_names=["Wall", "External Wall"],
        category="wall_segmentation",
    )
    next_ds = store.update_dataset_purpose(dataset["id"], "north_arrow")
    assert next_ds["category"] == "north_arrow"
    assert next_ds["task"] == "pose"
    assert next_ds["class_names"] == ["North Arrow"]

    custom = store.create_dataset(
        name="custom",
        task="segment",
        class_names=["Custom Wall"],
        category="wall_segmentation",
    )
    merged = store.update_dataset_purpose(custom["id"], "north_arrow")
    assert merged["class_names"][0] == "North Arrow"
    assert "Custom Wall" in merged["class_names"]

    leftover = store.create_dataset(
        name="layout leftover",
        task="detect",
        class_names=[
            "Title block",
            "Drawing area",
            "Legend block",
            "Drawing border",
            "Revision block",
            "North",
        ],
        category="layout_analysis",
    )
    cleaned = store.update_dataset_purpose(leftover["id"], "north_arrow")
    assert cleaned["class_names"] == ["North Arrow"]

