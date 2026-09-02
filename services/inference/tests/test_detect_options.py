from app.detect_options import wall_infer_overrides


def test_wall_infer_overrides_empty_keeps_server_defaults() -> None:
    assert wall_infer_overrides() == {}


def test_wall_infer_overrides_parses_tile_and_clamps() -> None:
    update = wall_infer_overrides(
        tile_walls="0",
        wall_imgsz="2048",
        wall_threshold="1.5",
        tile_overlap="0.9",
    )
    assert update["detect_tile_enabled"] is False
    assert update["mitunet_wall_imgsz"] == 1024
    assert update["detect_tile_size"] == 1024
    assert update["yolo_room_imgsz"] == 1024
    assert update["mitunet_wall_threshold"] == 0.95
    assert update["yolo_room_conf"] == 0.95
    assert update["detect_tile_overlap"] == 0.5


def test_wall_infer_overrides_accepts_truthy_tile_flag() -> None:
    assert wall_infer_overrides(tile_walls="1")["detect_tile_enabled"] is True
    assert wall_infer_overrides(tile_walls="false")["detect_tile_enabled"] is False
