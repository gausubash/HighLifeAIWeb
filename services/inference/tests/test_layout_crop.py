from __future__ import annotations

import numpy as np

from app.studio.layout_crop import (
    drawing_bbox_from_labelme_shapes,
    resolve_drawing_crop_xyxy,
)


def test_main_drawing_labelme_box_is_used() -> None:
    shapes = [
        {
            "label": "Main drawing",
            "points": [[10, 20], [210, 20], [210, 420], [10, 420]],
            "shape_type": "polygon",
        },
        {
            "label": "Wall",
            "points": [[30, 40], [80, 40], [80, 90], [30, 90]],
            "shape_type": "polygon",
        },
    ]
    bbox = drawing_bbox_from_labelme_shapes(shapes)
    assert bbox == (10.0, 20.0, 200.0, 400.0)


def test_resolve_crop_falls_back_to_full_page_dimensions() -> None:
    crop = resolve_drawing_crop_xyxy(800, 600, shapes=[])
    assert crop is None
    # Caller uses full page when None — verify manual box still works without rgb.
    crop = resolve_drawing_crop_xyxy(
        800,
        600,
        shapes=[
            {
                "label": "Drawing area",
                "points": [[0, 0], [400, 0], [400, 300], [0, 300]],
            }
        ],
    )
    assert crop is not None
    x0, y0, x1, y1 = crop
    assert x1 - x0 >= 400
    assert y1 - y0 >= 300


def test_drawing_area_type_flag_in_labelme() -> None:
    shapes = [
        {
            "label": "Zone A",
            "flags": {"layoutKind": "main_floorplan"},
            "points": [[5, 5], [105, 5], [105, 105], [5, 105]],
        }
    ]
    bbox = drawing_bbox_from_labelme_shapes(shapes)
    assert bbox == (5.0, 5.0, 100.0, 100.0)
