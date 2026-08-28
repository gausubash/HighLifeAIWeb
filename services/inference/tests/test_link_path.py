from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from app.studio import local_store as store


def test_link_image_folder_without_copy(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIGHLIFE_STUDIO_DIR", str(tmp_path / "studio"))
    source = tmp_path / "plans"
    source.mkdir()
    png = source / "unit.png"
    Image.new("RGB", (12, 8), (180, 180, 180)).save(png)
    (source / "unit.json").write_text(
        '{"shapes":[{"label":"Bedroom","shape_type":"polygon","points":[[1,1],[10,1],[10,6],[1,6]]}],'
        '"imagePath":"unit.png","imageWidth":12,"imageHeight":8}',
        encoding="utf-8",
    )

    dataset = store.create_dataset(name="linked", task="segment", class_names=["Bedroom"])
    summary = store.link_local_path(dataset["id"], str(source))
    assert summary["added_count"] == 1
    assert summary["image_count"] == 1
    assert summary["labeled_count"] == 1

    page = summary["pages"][0]
    assert page["link"] is True
    assert page["source_path"] == str(png.resolve())
    assert not (store.pages_dir(dataset["id"]) / f"{page['id']}.png").exists()

    png_bytes, width, height = store.read_page_png(dataset["id"], page)
    assert width == 12 and height == 8
    assert len(png_bytes) > 20
