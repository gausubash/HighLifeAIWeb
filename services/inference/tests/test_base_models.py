from app.studio.dataset import assert_base_model, list_base_models


def test_list_base_models_covers_yolo_ladder_and_mmdet():
    detect = list_base_models("detect")
    seg = list_base_models("segment")
    detect_ids = {m["id"] for m in detect}
    seg_ids = {m["id"] for m in seg}
    assert "yolov8n.pt" in detect_ids
    assert "yolov8x.pt" in detect_ids
    assert "yolo11m.pt" in detect_ids
    assert "retinanet_latest.pth" in detect_ids
    assert "faster_rcnn_latest.pth" in detect_ids
    assert "cascade_swin_latest.pth" in detect_ids
    assert "yolov8n-seg.pt" in seg_ids
    assert "yolo11x-seg.pt" in seg_ids
    assert "deeplab_walls_best.h5" in seg_ids
    assert "unet_walls_best.h5" in seg_ids
    assert "retinanet_latest.pth" not in seg_ids


def test_assert_base_model_task_guards():
    assert assert_base_model("detect", "faster_rcnn") == "faster_rcnn_latest.pth"
    assert assert_base_model("detect", "cascade_swin") == "cascade_swin_latest.pth"
    try:
        assert_base_model("segment", "faster_rcnn_latest.pth")
        raise AssertionError("expected ValueError")
    except ValueError:
        pass
    try:
        assert_base_model("detect", "deeplab_walls_best.h5")
        raise AssertionError("expected ValueError")
    except ValueError:
        pass
