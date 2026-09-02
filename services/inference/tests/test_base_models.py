from app.studio.dataset import assert_base_model, list_base_models


def test_list_base_models_are_task_split():
    detect = list_base_models("detect")
    seg = list_base_models("segment")
    detect_ids = {m["id"] for m in detect}
    seg_ids = {m["id"] for m in seg}
    assert "yolov8n.pt" in detect_ids
    assert "yolo_room.pt" in detect_ids or "yolo_layout.pt" in detect_ids
    assert "yolo_layout.pt" in detect_ids
    assert "yolo_walls_obb.pt" in detect_ids
    assert "retinanet_latest.pth" not in detect_ids
    assert "faster_rcnn_latest.pth" not in detect_ids
    assert "yolov8n-seg.pt" in seg_ids
    assert "mitunet_walls.pth" in seg_ids
    assert "deeplab_walls_best.h5" not in seg_ids
    assert "unet_walls_best.h5" not in seg_ids
    wall_seg = [m for m in seg if m.get("category") == "wall_segmentation"]
    assert all(m["id"] == "mitunet_walls.pth" for m in wall_seg)
    pose = list_base_models("pose")
    north_ids = {
        m["id"]
        for m in pose
        if m.get("category") == "north_arrow" or "north_arrow" in (m.get("categories") or [])
    }
    assert "yolo26n-pose.pt" in north_ids
    assert all(mid.endswith("-pose.pt") for mid in north_ids)
    assert "yolov8n.pt" not in north_ids


def test_assert_base_model_task_guards():
    assert assert_base_model("detect", "yolov8n.pt") == "yolov8n.pt"
    assert assert_base_model("pose", "yolo26n-pose.pt") == "yolo26n-pose.pt"
    try:
        assert_base_model("segment", "yolov8n.pt")
        raise AssertionError("expected ValueError")
    except ValueError:
        pass
    try:
        assert_base_model("detect", "yolov8n-seg.pt")
        raise AssertionError("expected ValueError")
    except ValueError:
        pass
