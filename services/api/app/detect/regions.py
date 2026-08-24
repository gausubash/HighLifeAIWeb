from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

PROCESS_MAX_EDGE = 1600
MIN_AREA_FRAC = 0.0012
MAX_AREA_FRAC = 0.52
MAX_POLYGON_VERTICES = 80


@dataclass(frozen=True)
class ProposedRegion:
    polygon: np.ndarray  # (N, 2) in original image pixels
    bbox: tuple[float, float, float, float]  # x, y, w, h original px
    area_px: float
    perimeter_px: float
    mean_gray: float
    ink_density: float


def _processing_scale(width: int, height: int, max_edge: int = PROCESS_MAX_EDGE) -> float:
    longest = max(width, height)
    if longest <= max_edge:
        return 1.0
    return max_edge / longest


def _simplify_polygon(contour: np.ndarray) -> np.ndarray:
    peri = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, max(1.5, 0.008 * peri), True)
    pts = approx.reshape(-1, 2).astype(np.float64)
    if pts.shape[0] > MAX_POLYGON_VERTICES:
        step = int(np.ceil(pts.shape[0] / MAX_POLYGON_VERTICES))
        pts = pts[::step]
    if pts.shape[0] >= 3:
        return pts
    x, y, w, h = cv2.boundingRect(contour)
    return np.array(
        [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
        dtype=np.float64,
    )


def propose_enclosed_regions(rgb: np.ndarray) -> list[ProposedRegion]:
    """Find interior empty spaces bounded by ink (walls / drawing lines)."""
    if rgb.ndim != 3 or rgb.shape[2] < 3:
        raise ValueError("Expected an RGB image array.")
    src_h, src_w = rgb.shape[:2]
    scale = _processing_scale(src_w, src_h)
    if scale < 1.0:
        proc_w = max(1, int(round(src_w * scale)))
        proc_h = max(1, int(round(src_h * scale)))
        proc = cv2.resize(rgb, (proc_w, proc_h), interpolation=cv2.INTER_AREA)
    else:
        proc = rgb
        proc_w, proc_h = src_w, src_h

    gray = cv2.cvtColor(proc, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    block = 25 if min(proc_w, proc_h) > 200 else 11
    if block % 2 == 0:
        block += 1
    ink = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        block,
        8,
    )
    gap = max(3, int(round(min(proc_w, proc_h) * 0.004)))
    if gap % 2 == 0:
        gap += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (gap, gap))
    walls = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, kernel, iterations=1)
    walls = cv2.dilate(walls, kernel, iterations=1)

    free = cv2.bitwise_not(walls)
    flood = free.copy()
    mask = np.zeros((proc_h + 2, proc_w + 2), np.uint8)
    seeds = [
        (0, 0),
        (proc_w - 1, 0),
        (0, proc_h - 1),
        (proc_w - 1, proc_h - 1),
        (proc_w // 2, 0),
        (proc_w // 2, proc_h - 1),
        (0, proc_h // 2),
        (proc_w - 1, proc_h // 2),
    ]
    for x, y in seeds:
        if flood[y, x] > 0:
            cv2.floodFill(flood, mask, (x, y), 128)

    exterior = np.where(flood == 128, 255, 0).astype(np.uint8)
    interior = cv2.bitwise_and(free, cv2.bitwise_not(exterior))
    interior = cv2.bitwise_and(interior, cv2.bitwise_not(walls))
    clean_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    interior = cv2.morphologyEx(interior, cv2.MORPH_OPEN, clean_k)

    n_labels, labels, stats, _centroids = cv2.connectedComponentsWithStats(interior, connectivity=8)
    page_area = float(proc_w * proc_h)
    inv_scale = 1.0 / scale
    regions: list[ProposedRegion] = []

    for i in range(1, n_labels):
        area = float(stats[i, cv2.CC_STAT_AREA])
        frac = area / page_area
        if frac < MIN_AREA_FRAC or frac > MAX_AREA_FRAC:
            continue
        component = np.where(labels == i, 255, 0).astype(np.uint8)
        contours, _ = cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        contour = max(contours, key=cv2.contourArea)
        if cv2.contourArea(contour) < area * 0.4:
            continue
        poly_proc = _simplify_polygon(contour)
        peri = float(cv2.arcLength(contour, True))
        x, y, bw, bh = (float(v) for v in cv2.boundingRect(contour))
        mean_gray = float(cv2.mean(gray, mask=component)[0])
        ink_density = float(cv2.mean(ink, mask=component)[0]) / 255.0

        poly = poly_proc * inv_scale
        regions.append(
            ProposedRegion(
                polygon=poly,
                bbox=(x * inv_scale, y * inv_scale, bw * inv_scale, bh * inv_scale),
                area_px=area * inv_scale * inv_scale,
                perimeter_px=peri * inv_scale,
                mean_gray=mean_gray,
                ink_density=ink_density,
            )
        )

    regions.sort(key=lambda r: r.area_px, reverse=True)
    return regions
