"""Letterbox helpers keep mask coordinates aligned with the page."""

from __future__ import annotations

import numpy as np

from app.yolo.letterbox import letterbox_rgb, unletterbox_mask


def test_letterbox_roundtrip_preserves_hotspot_location() -> None:
    # Wide page with a bright block on the right — squash would pull it left.
    rgb = np.zeros((100, 400, 3), dtype=np.uint8)
    rgb[40:60, 300:340] = 255
    canvas, scale, ox, oy, orig_hw = letterbox_rgb(rgb, 128, fill=0, center=True)
    assert canvas.shape == (128, 128, 3)

    # Synthetic mask: mark the letterboxed location of the block.
    mask = np.zeros((128, 128), dtype=np.float32)
    # Map block center into letterbox coords.
    cx = 320 * scale + ox
    cy = 50 * scale + oy
    mask[int(cy) - 2 : int(cy) + 3, int(cx) - 2 : int(cx) + 3] = 1.0

    restored = unletterbox_mask(
        mask,
        scale=scale,
        offset_x=ox,
        offset_y=oy,
        orig_hw=orig_hw,
        canvas_size=128,
    )
    assert restored.shape == (100, 400)
    ys, xs = np.where(restored > 0.5)
    assert xs.size > 0
    assert abs(float(xs.mean()) - 320) < 25
    assert abs(float(ys.mean()) - 50) < 15
