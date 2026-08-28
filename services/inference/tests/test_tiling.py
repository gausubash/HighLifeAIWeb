from __future__ import annotations

import numpy as np

from app.yolo.predict import DetectedRegion
from app.yolo.tiling import (
    extract_tile_rgb,
    iter_tiles,
    maybe_tiled_detect,
    nms_regions,
    offset_region,
    run_tiled_detect,
    should_tile,
)


def test_should_tile() -> None:
    assert should_tile(4000, 3000, tile_size=640, min_side=1280) is True
    assert should_tile(800, 600, tile_size=640, min_side=1280) is False
    assert should_tile(2000, 2000, tile_size=0, min_side=1280) is False
    # Drawing-area crops tile when larger than model imgsz, not the global 1280 gate.
    assert should_tile(1000, 800, tile_size=896, min_side=896) is True
    assert should_tile(800, 600, tile_size=896, min_side=896) is False


def test_iter_tiles_covers_image() -> None:
    tiles = iter_tiles(1000, 1500, tile_size=640, overlap=0.2)
    assert len(tiles) >= 4
    assert tiles[0].x0 == 0 and tiles[0].y0 == 0
    assert max(t.x1 for t in tiles) == 1500
    assert max(t.y1 for t in tiles) == 1000
    # Overlap: consecutive tiles on first row share pixels.
    row0 = [t for t in tiles if t.y0 == 0]
    assert len(row0) >= 2
    assert row0[0].x1 > row0[1].x0


def test_extract_and_offset_roundtrip() -> None:
    rgb = np.zeros((200, 300, 3), dtype=np.uint8)
    rgb[50:90, 100:140] = 255
    tiles = iter_tiles(200, 300, tile_size=128, overlap=0.25)
    tile = next(t for t in tiles if t.x0 <= 100 < t.x1 and t.y0 <= 50 < t.y1)
    crop = extract_tile_rgb(rgb, tile, pad_to=128)
    assert crop.shape == (128, 128, 3)
    region = DetectedRegion(
        id="1",
        type="wall",
        label="Wall",
        confidence=0.9,
        polygon=[(10, 10), (40, 10), (40, 40), (10, 40)],
        bbox=(10, 10, 30, 30),
    )
    shifted = offset_region(region, tile.x0, tile.y0)
    assert shifted.bbox[0] == tile.x0 + 10
    assert shifted.bbox[1] == tile.y0 + 10


def test_nms_regions_drops_overlap() -> None:
    a = DetectedRegion(
        id="a",
        type="wall",
        label="Wall",
        confidence=0.9,
        polygon=[(0, 0), (10, 0), (10, 10), (0, 10)],
        bbox=(0, 0, 10, 10),
    )
    b = DetectedRegion(
        id="b",
        type="wall",
        label="Wall",
        confidence=0.5,
        polygon=[(1, 1), (11, 1), (11, 11), (1, 11)],
        bbox=(1, 1, 10, 10),
    )
    kept = nms_regions([a, b], iou_threshold=0.3)
    assert len(kept) == 1
    assert kept[0].id == "a"


def test_merge_tiled_regions_unions_overlap_instead_of_dropping() -> None:
    from app.yolo.tile_merge import merge_tiled_regions

    a = DetectedRegion(
        id="a",
        type="room",
        label="Bedroom",
        confidence=0.9,
        polygon=[(0, 0), (100, 0), (100, 80), (0, 80)],
        bbox=(0, 0, 100, 80),
    )
    b = DetectedRegion(
        id="b",
        type="room",
        label="Bedroom",
        confidence=0.5,
        polygon=[(40, 0), (140, 0), (140, 80), (40, 80)],
        bbox=(40, 0, 100, 80),
    )
    kept = merge_tiled_regions([a, b], iou_threshold=0.45)
    assert len(kept) == 1
    xs = [p[0] for p in kept[0].polygon]
    assert min(xs) <= 1
    assert max(xs) >= 139
    assert kept[0].confidence == 0.9
    assert kept[0].attributes.get("stitchedFrom") == 2


def test_merge_tiled_regions_keeps_side_by_side_instances() -> None:
    from app.yolo.tile_merge import merge_tiled_regions

    a = DetectedRegion(
        id="a",
        type="room",
        label="Bedroom",
        confidence=0.9,
        polygon=[(0, 0), (40, 0), (40, 40), (0, 40)],
        bbox=(0, 0, 40, 40),
    )
    b = DetectedRegion(
        id="b",
        type="room",
        label="Bedroom",
        confidence=0.8,
        polygon=[(80, 0), (120, 0), (120, 40), (80, 40)],
        bbox=(80, 0, 40, 40),
    )
    kept = merge_tiled_regions([a, b], iou_threshold=0.45)
    assert len(kept) == 2


def test_merge_tiled_regions_unions_tile_seam_fragments() -> None:
    from app.yolo.tile_merge import merge_tiled_regions

    a = DetectedRegion(
        id="a",
        type="wall",
        label="Wall",
        confidence=0.8,
        polygon=[(0, 10), (100, 10), (100, 28), (0, 28)],
        bbox=(0, 10, 100, 18),
        attributes={"tile": {"x": 0, "y": 0, "width": 100, "height": 200}},
    )
    b = DetectedRegion(
        id="b",
        type="wall",
        label="Wall",
        confidence=0.7,
        polygon=[(90, 10), (180, 10), (180, 28), (90, 28)],
        bbox=(90, 10, 90, 18),
        attributes={"tile": {"x": 80, "y": 0, "width": 100, "height": 200}},
    )
    kept = merge_tiled_regions([a, b], iou_threshold=0.45)
    assert len(kept) == 1
    xs = [p[0] for p in kept[0].polygon]
    ys = [p[1] for p in kept[0].polygon]
    assert max(xs) - min(xs) >= 170
    assert max(ys) - min(ys) <= 30


def test_run_tiled_detect_merges_tiles() -> None:
    rgb = np.full((1600, 1600, 3), 240, dtype=np.uint8)
    calls: list[tuple[int, int]] = []

    def predict(crop: np.ndarray) -> list[DetectedRegion]:
        calls.append((crop.shape[0], crop.shape[1]))
        return [
            DetectedRegion(
                id="t",
                type="wall",
                label="Wall",
                confidence=0.8,
                polygon=[(5, 5), (20, 5), (20, 20), (5, 20)],
                bbox=(5, 5, 15, 15),
            )
        ]

    regions = run_tiled_detect(
        rgb,
        predict_fn=predict,
        tile_size=640,
        overlap=0.2,
        min_side=1280,
        iou_threshold=0.45,
    )
    assert len(calls) > 1
    assert all(h == 640 and w == 640 for h, w in calls)
    assert len(regions) >= 1


def test_run_tiled_detect_progress_events() -> None:
    rgb = np.full((1600, 1600, 3), 240, dtype=np.uint8)
    events: list[tuple[str, dict]] = []

    def predict(crop: np.ndarray) -> list[DetectedRegion]:
        return [
            DetectedRegion(
                id="t",
                type="wall",
                label="Wall",
                confidence=0.8,
                polygon=[(5, 5), (20, 5), (20, 20), (5, 20)],
                bbox=(5, 5, 15, 15),
            )
        ]

    def on_progress(kind: str, data: dict) -> None:
        events.append((kind, data))

    run_tiled_detect(
        rgb,
        predict_fn=predict,
        tile_size=640,
        overlap=0.2,
        min_side=1280,
        on_progress=on_progress,
    )
    kinds = [k for k, _ in events]
    assert kinds[0] == "meta"
    assert events[0][1]["tiled"] is True
    assert events[0][1]["tileCount"] > 1
    assert "tile_start" in kinds
    assert "tile_done" in kinds
    starts = [d for k, d in events if k == "tile_start"]
    assert starts[0]["index"] == 1
    assert starts[0]["total"] == events[0][1]["tileCount"]


def test_stitch_wall_regions_keeps_seam_pieces() -> None:
    """Touching walls must not collapse into one AABB covering both (old bug)."""
    from app.yolo.tiling import stitch_wall_regions

    a = DetectedRegion(
        id="a",
        type="wall",
        label="Wall",
        confidence=0.9,
        polygon=[(0, 0), (100, 0), (100, 20), (0, 20)],
        bbox=(0, 0, 100, 20),
    )
    b = DetectedRegion(
        id="b",
        type="wall",
        label="Wall",
        confidence=0.7,
        polygon=[(98, 0), (200, 0), (200, 20), (98, 20)],
        bbox=(98, 0, 102, 20),
    )
    door = DetectedRegion(
        id="d",
        type="door",
        label="Door",
        confidence=0.8,
        polygon=[(40, 40), (60, 40), (60, 80), (40, 80)],
        bbox=(40, 40, 20, 40),
    )
    out = stitch_wall_regions([a, b, door])
    walls = [r for r in out if r.type == "wall"]
    # Low-IoU seam neighbors stay as separate segments (no giant filled rect).
    assert len(walls) == 2
    assert any(r.type == "door" for r in out)
    for wall in walls:
        xs = [p[0] for p in wall.polygon]
        ys = [p[1] for p in wall.polygon]
        # Neither wall should expand to the full 0..200 span as a solid box fill.
        assert max(xs) - min(xs) < 150


def test_stitch_wall_regions_merges_high_iou_overlap() -> None:
    from app.yolo.tiling import stitch_wall_regions

    a = DetectedRegion(
        id="a",
        type="wall",
        label="Wall",
        confidence=0.9,
        polygon=[(0, 0), (100, 0), (100, 40), (0, 40)],
        bbox=(0, 0, 100, 40),
    )
    b = DetectedRegion(
        id="b",
        type="wall",
        label="Wall",
        confidence=0.7,
        polygon=[(10, 5), (110, 5), (110, 45), (10, 45)],
        bbox=(10, 5, 100, 40),
    )
    out = stitch_wall_regions([a, b])
    walls = [r for r in out if r.type == "wall"]
    assert len(walls) == 1
    assert walls[0].confidence == 0.9
    xs = [p[0] for p in walls[0].polygon]
    ys = [p[1] for p in walls[0].polygon]
    assert min(xs) <= 1
    assert max(xs) >= 109
    assert max(ys) - min(ys) <= 50


def test_maybe_tiled_respects_disabled() -> None:
    from app.config import Settings

    settings = Settings(DETECT_TILE_ENABLED=False)
    rgb = np.zeros((2000, 2000, 3), dtype=np.uint8)
    calls = {"n": 0}

    def predict(crop: np.ndarray) -> list[DetectedRegion]:
        calls["n"] += 1
        return []

    maybe_tiled_detect(rgb, settings=settings, predict_fn=predict, tile_size=640)
    assert calls["n"] == 1


def test_map_progress_coords_does_not_mutate_or_double_scale() -> None:
    """Stream progress used to scale in-place; final path scaled again → shifted overlays."""
    from app.yolo.tiling import map_progress_coords

    region = DetectedRegion(
        id="r1",
        type="wall",
        label="Wall",
        confidence=0.8,
        polygon=[(10.0, 20.0), (30.0, 20.0), (30.0, 40.0), (10.0, 40.0)],
        bbox=(10.0, 20.0, 20.0, 20.0),
    )
    collected = [region]
    events: list[tuple[str, object]] = []

    def on_progress(kind: str, data: dict) -> None:
        events.append((kind, data.get("regions")))

    emit = map_progress_coords(on_progress, dx=0.0, dy=0.0, sx=2.0, sy=2.0)
    assert emit is not None
    emit("tile_done", {"regions": collected, "tile": {"x": 0, "y": 0, "width": 100, "height": 100}})

    # Collected stays in source-image space for the final scale pass.
    assert region.bbox == (10.0, 20.0, 20.0, 20.0)
    assert region.polygon[0] == (10.0, 20.0)

    streamed = events[0][1]
    assert isinstance(streamed, list) and len(streamed) == 1
    assert streamed[0].bbox == (20.0, 40.0, 40.0, 40.0)

    from app.yolo.predict import _scale_region_to_original

    final = _scale_region_to_original(region, 2.0, 2.0)
    assert final.bbox == streamed[0].bbox
    # Original still untouched after final copy-scale.
    assert region.bbox == (10.0, 20.0, 20.0, 20.0)
