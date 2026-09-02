from __future__ import annotations

from pathlib import Path

import pytest
from app.studio.dataset import assert_base_model, is_retinanet_base
from app.studio.retinanet import load_yolo_boxes


def test_is_retinanet_base() -> None:
    assert is_retinanet_base("retinanet_latest.pth")
    assert is_retinanet_base("wall:retinanet")
    assert not is_retinanet_base("yolov8n.pt")


def test_assert_base_model_retinanet() -> None:
    assert assert_base_model("detect", "retinanet_latest.pth") == "retinanet_latest.pth"
    with pytest.raises(ValueError, match="detect base"):
        assert_base_model("segment", "retinanet")


def test_load_yolo_boxes_from_polygon_line(tmp_path: Path) -> None:
    label = tmp_path / "page.txt"
    label.write_text("0 0.1 0.1 0.9 0.1 0.9 0.9 0.1 0.9\n", encoding="utf-8")
    boxes, labels = load_yolo_boxes(label_path=label, width=100, height=100)
    assert labels == [0]
    assert len(boxes) == 1
    assert boxes[0][0] == pytest.approx(10.0)
    assert boxes[0][2] == pytest.approx(90.0)


def test_load_yolo_boxes_from_detect_line(tmp_path: Path) -> None:
    label = tmp_path / "page.txt"
    label.write_text("1 0.5 0.5 0.4 0.3\n", encoding="utf-8")
    boxes, labels = load_yolo_boxes(label_path=label, width=200, height=100)
    assert labels == [1]
    x1, y1, x2, y2 = boxes[0]
    assert x2 - x1 == pytest.approx(80.0)
    assert y2 - y1 == pytest.approx(30.0)



@pytest.mark.parametrize("backend", ["retinanet"])
def test_retinanet_pretrained_available(backend: str) -> None:
    root = Path(__file__).resolve().parents[1]
    weights = root / "models" / "retinanet_latest.pth"
    if not weights.is_file():
        pytest.skip("retinanet_latest.pth not on disk")
    from app.yolo.mmdet_wall import _load_checkpoint, _strip_prefix, build_torchvision_retinanet

    state = _strip_prefix(_load_checkpoint(weights).get("state_dict") or {})
    model = build_torchvision_retinanet(num_classes=3, mmdet_state=state)
    assert model is not None
