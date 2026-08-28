"""Aspect-preserving letterbox for mask models (avoids squashing → shifted overlays)."""

from __future__ import annotations

import numpy as np
from PIL import Image


def letterbox_rgb(
    rgb: np.ndarray,
    size: int,
    *,
    fill: int = 255,
    center: bool = True,
) -> tuple[np.ndarray, float, int, int, tuple[int, int]]:
    """
    Fit ``rgb`` into a ``size``×``size`` canvas without changing aspect ratio.

    Returns ``(canvas, scale, offset_x, offset_y, (orig_h, orig_w))``.
    """
    height, width = int(rgb.shape[0]), int(rgb.shape[1])
    size = max(32, int(size))
    scale = float(size) / float(max(height, width, 1))
    new_w = max(1, int(round(width * scale)))
    new_h = max(1, int(round(height * scale)))
    resized = Image.fromarray(np.ascontiguousarray(rgb)).convert("RGB").resize(
        (new_w, new_h), Image.BILINEAR
    )
    canvas = Image.new("RGB", (size, size), (fill, fill, fill))
    ox = (size - new_w) // 2 if center else 0
    oy = (size - new_h) // 2 if center else 0
    canvas.paste(resized, (ox, oy))
    return np.asarray(canvas, dtype=np.uint8), scale, ox, oy, (height, width)


def unletterbox_mask(
    mask: np.ndarray,
    *,
    scale: float,
    offset_x: int,
    offset_y: int,
    orig_hw: tuple[int, int],
    canvas_size: int,
) -> np.ndarray:
    """Map a square letterboxed mask back to original ``(H, W)`` [or ``(H, W, C)``]."""
    orig_h, orig_w = orig_hw
    size = max(32, int(canvas_size))
    new_w = max(1, int(round(orig_w * scale)))
    new_h = max(1, int(round(orig_h * scale)))
    x0 = max(0, int(offset_x))
    y0 = max(0, int(offset_y))
    x1 = min(size, x0 + new_w)
    y1 = min(size, y0 + new_h)

    def _resize_plane(plane: np.ndarray) -> np.ndarray:
        crop = plane[y0:y1, x0:x1]
        if crop.size == 0:
            return np.zeros((orig_h, orig_w), dtype=np.float32)
        return np.asarray(
            Image.fromarray(crop.astype(np.float32), mode="F").resize(
                (orig_w, orig_h), Image.BILINEAR
            ),
            dtype=np.float32,
        )

    if mask.ndim == 2:
        return _resize_plane(mask)
    if mask.ndim == 3:
        channels = mask.shape[-1]
        out = np.zeros((orig_h, orig_w, channels), dtype=np.float32)
        for c in range(channels):
            out[..., c] = _resize_plane(mask[..., c])
        return out
    raise ValueError(f"Unexpected mask rank: {mask.ndim}")
