from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from app.yolo.train_tiles import expand_yolo_split_with_tiles


def test_expand_yolo_split_with_tiles(tmp_path: Path) -> None:
    images = tmp_path / "images"
    labels = tmp_path / "labels"
    images.mkdir()
    labels.mkdir()
    # Large synthetic page with one centered box polygon.
    Image.fromarray(np.full((1600, 1600, 3), 220, dtype=np.uint8)).save(images / "page.png")
    # YOLO-seg: class 0 + normalized polygon covering center.
    (labels / "page.txt").write_text(
        "0 0.40 0.40 0.60 0.40 0.60 0.60 0.40 0.60\n",
        encoding="utf-8",
    )
    stats = expand_yolo_split_with_tiles(
        images,
        labels,
        tile_size=640,
        overlap=0.2,
        min_side=1280,
        keep_full_page_frac=0.0,
        task="segment",
    )
    assert stats["tiles"] >= 1
    tile_imgs = list(images.glob("page_tile*.png"))
    assert len(tile_imgs) >= 1
    # Original removed when keep_full_page_frac=0
    assert not (images / "page.png").exists()
    assert stats["tiles"] == len(tile_imgs)
