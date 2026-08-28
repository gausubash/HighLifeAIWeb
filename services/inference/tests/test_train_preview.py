from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
from PIL import Image

from app.studio.train_job import _write_segmentation_preview


class _FakeResult:
    def plot(self):
        return np.zeros((32, 48, 3), dtype=np.uint8)


def test_write_segmentation_preview_copies_weights_to_temp(tmp_path: Path) -> None:
    weights = tmp_path / "last.pt"
    sample = tmp_path / "page.png"
    out_path = tmp_path / "preview.png"
    weights.write_bytes(b"fake-weights")
    Image.new("RGB", (40, 30), color=(255, 255, 255)).save(sample)

    fake_yolo = MagicMock()
    fake_yolo.predict.return_value = [_FakeResult()]

    with patch("ultralytics.YOLO", return_value=fake_yolo) as yolo_ctor:
        ok = _write_segmentation_preview(weights=weights, sample=sample, out_path=out_path, imgsz=640)

    assert ok is True
    assert out_path.is_file()
    yolo_ctor.assert_called_once()
    loaded_path = Path(yolo_ctor.call_args[0][0])
    assert loaded_path.name == "preview_weights.pt"
    fake_yolo.predict.assert_called_once()
