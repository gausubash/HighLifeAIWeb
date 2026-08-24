"""Blueprint / PDF page size parsing and scale calibration helpers.

Ported from BuildPro (packages/python-shared/src/buildpro_shared/blueprint.py).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

PT_PER_INCH = 72.0
MM_PER_INCH = 25.4


def points_to_mm(pt: float) -> float:
    return pt * MM_PER_INCH / PT_PER_INCH


def points_to_inches(pt: float) -> float:
    return pt / PT_PER_INCH


@dataclass(frozen=True)
class PaperSizeMatch:
    name: str
    width_mm: float
    height_mm: float


@dataclass(frozen=True)
class AutoCalibration:
    pixels_per_unit: float
    unit: str
    scale_label: str
    width_mm: float
    height_mm: float
    paper_size: str | None


_ISO_AND_ARCH_MM: list[tuple[str, float, float]] = [
    ("ISO A0", 841, 1189),
    ("ISO A1", 594, 841),
    ("ISO A2", 420, 594),
    ("ISO A3", 297, 420),
    ("ISO A4", 210, 297),
    ("ARCH E", 864, 1296),
    ("ARCH D", 610, 914),
    ("ARCH C", 457, 610),
    ("ARCH B", 305, 457),
    ("ARCH A", 229, 305),
    ("ANSI D", 559, 864),
    ("ANSI E", 864, 1118),
]


def match_paper_size(width_pt: float, height_pt: float, tolerance_mm: float = 8.0) -> PaperSizeMatch | None:
    w_mm = points_to_mm(min(width_pt, height_pt))
    h_mm = points_to_mm(max(width_pt, height_pt))

    best: PaperSizeMatch | None = None
    best_delta = tolerance_mm + 1

    for name, short, long in _ISO_AND_ARCH_MM:
        delta = abs(w_mm - short) + abs(h_mm - long)
        if delta <= tolerance_mm and delta < best_delta:
            best_delta = delta
            best = PaperSizeMatch(name=name, width_mm=short, height_mm=long)

    if best:
        return best

    return PaperSizeMatch(
        name=f"Custom {w_mm:.0f}×{h_mm:.0f} mm",
        width_mm=round(w_mm, 1),
        height_mm=round(h_mm, 1),
    )


def compute_calibration_from_paper(
    width_px: int,
    height_px: int,
    width_pt: float,
    height_pt: float,
    unit: str = "m",
    *,
    dpi: float | None = None,
) -> AutoCalibration | None:
    if width_px <= 0 or height_px <= 0:
        return None

    if dpi and dpi > 0:
        from app.pipeline.scale_converter import (
            infer_paper_dimensions_mm,
            infer_paper_size_from_pixels,
        )
        short_mm, long_mm = infer_paper_dimensions_mm(width_px, height_px, dpi)
        paper_code = infer_paper_size_from_pixels(width_px, height_px, dpi)
        width_m = short_mm / 1000.0
        if width_m <= 0:
            return None
        pixels_per_unit = width_px / width_m
        scale_label = f"{paper_code or 'Custom'} @ {int(dpi)} DPI (1:1 paper)"
        return AutoCalibration(
            pixels_per_unit=pixels_per_unit,
            unit=unit,
            scale_label=scale_label,
            width_mm=short_mm,
            height_mm=long_mm,
            paper_size=paper_code or f"Custom {short_mm:.0f}×{long_mm:.0f} mm",
        )

    if width_pt <= 0 or height_pt <= 0:
        return None

    paper = match_paper_size(width_pt, height_pt)
    if paper is None:
        return None

    width_m = paper.width_mm / 1000.0
    pixels_per_unit = width_px / width_m

    short_in = points_to_inches(min(width_pt, height_pt))
    long_in = points_to_inches(max(width_pt, height_pt))
    scale_label = paper.name if not paper.name.startswith("Custom") else f"{short_in:.0f}×{long_in:.0f} in"

    return AutoCalibration(
        pixels_per_unit=pixels_per_unit,
        unit=unit,
        scale_label=scale_label,
        width_mm=paper.width_mm,
        height_mm=paper.height_mm,
        paper_size=paper.name,
    )


def normalized_line_length_px(
    x1: float, y1: float, x2: float, y2: float,
    width_px: int, height_px: int,
) -> float:
    dx = (x2 - x1) * width_px
    dy = (y2 - y1) * height_px
    return (dx * dx + dy * dy) ** 0.5


def geometry_pixel_length(geometry: dict, width_px: int, height_px: int) -> float:
    gtype = geometry.get("type")
    if gtype == "line" and geometry.get("x1") is not None:
        return normalized_line_length_px(
            geometry["x1"], geometry["y1"],
            geometry["x2"], geometry["y2"],
            width_px, height_px,
        )
    if gtype == "bbox" and geometry.get("width") is not None:
        w = geometry["width"] * width_px
        h = (geometry.get("height") or 0) * height_px
        return 2 * (w + h)
    if gtype == "polyline" and geometry.get("points"):
        pts = geometry["points"]
        total = 0.0
        for i in range(1, len(pts)):
            total += normalized_line_length_px(
                pts[i - 1]["x"], pts[i - 1]["y"],
                pts[i]["x"], pts[i]["y"],
                width_px, height_px,
            )
        return total
    return 0.0


def geometry_pixel_area(geometry: dict, width_px: int, height_px: int) -> float:
    gtype = geometry.get("type")
    if gtype == "bbox" and geometry.get("width") is not None:
        return geometry["width"] * width_px * (geometry.get("height") or 0) * height_px
    if gtype == "polygon" and geometry.get("points"):
        pts = geometry["points"]
        if len(pts) < 3:
            return 0.0
        area = 0.0
        for i in range(len(pts)):
            j = (i + 1) % len(pts)
            xi, yi = pts[i]["x"] * width_px, pts[i]["y"] * height_px
            xj, yj = pts[j]["x"] * width_px, pts[j]["y"] * height_px
            area += xi * yj - xj * yi
        return abs(area) / 2.0
    return 0.0


def compute_measurement_value(
    geometry: dict,
    width_px: int,
    height_px: int,
    pixels_per_unit: float,
    measurement_type: str,
) -> tuple[str, float]:
    if pixels_per_unit <= 0:
        raise ValueError("Invalid calibration")
    if measurement_type == "length":
        px = geometry_pixel_length(geometry, width_px, height_px)
        return "m", px / pixels_per_unit
    if measurement_type == "area":
        px_area = geometry_pixel_area(geometry, width_px, height_px)
        real_per_px = 1.0 / pixels_per_unit
        return "m2", px_area * real_per_px * real_per_px
    if measurement_type == "count":
        return "nr", 1.0
    raise ValueError(f"Unknown measurement type: {measurement_type}")


_SCALE_RATIO_RE = re.compile(
    r"(?i)(?:scale\s*[:=]?\s*)?(?:[1lI|]\s*[:/\-．.]\s*)(\d{1,5})\b"
)


def parse_scale_ratio(text: str) -> int | None:
    if not text:
        return None
    from app.pipeline.scale_converter import (
        normalize_ocr_scale_text,
        parse_scale_and_paper,
        parse_scale_ratio_from_text,
    )
    via_helper = parse_scale_ratio_from_text(text)
    if via_helper is not None:
        return via_helper
    decl = parse_scale_and_paper(text)
    if decl:
        return decl[0]
    best: int | None = None
    for candidate in (text, normalize_ocr_scale_text(text)):
        for m in _SCALE_RATIO_RE.finditer(candidate):
            ratio = int(m.group(1))
            if 5 <= ratio <= 10000:
                if best is None or ratio > best:
                    best = ratio
    return best


def parse_scale_and_paper(text: str) -> tuple[int, str] | None:
    from app.pipeline.scale_converter import parse_scale_and_paper as _parse
    return _parse(text)


def compute_calibration_from_scale_declaration(
    width_px: int,
    height_px: int,
    dpi: float,
    original_scale: int,
    original_paper: str,
    *,
    target_paper: str | None = None,
    unit: str = "m",
    physical_short_mm: float | None = None,
    physical_long_mm: float | None = None,
    pdf_width_pt: float | None = None,
    pdf_height_pt: float | None = None,
    paper_size_name: str | None = None,
) -> AutoCalibration | None:
    from app.pipeline.scale_converter import (
        build_calibration_from_scale_declaration,
        infer_paper_dimensions_mm,
        oriented_sheet_mm,
    )
    info = build_calibration_from_scale_declaration(
        width_px=width_px, height_px=height_px, dpi=dpi,
        original_scale=original_scale, original_paper=original_paper,
        target_paper=target_paper, unit=unit,
        physical_short_mm=physical_short_mm, physical_long_mm=physical_long_mm,
        pdf_width_pt=pdf_width_pt, pdf_height_pt=pdf_height_pt,
        paper_size_name=paper_size_name,
    )
    if info is None or info.pixels_per_unit <= 0:
        return None
    short_mm, long_mm = infer_paper_dimensions_mm(width_px, height_px, dpi)
    if physical_short_mm and physical_long_mm:
        w_mm, h_mm = oriented_sheet_mm(width_px, height_px, physical_short_mm, physical_long_mm)
        short_mm, long_mm = min(w_mm, h_mm), max(w_mm, h_mm)
    eff = info.effective_scale
    eff_str = f"{eff:.0f}" if abs(eff - round(eff)) < 0.05 else f"{eff:.1f}"
    label = f"1:{info.original_scale}({info.original_paper}) | 1:{eff_str}({info.target_paper})"
    return AutoCalibration(
        pixels_per_unit=info.pixels_per_unit,
        unit=unit,
        scale_label=label,
        width_mm=short_mm,
        height_mm=long_mm,
        paper_size=f"{info.target_paper} (render @ {int(info.dpi)} DPI)",
    )


def compute_calibration_from_scale_ratio(
    width_px: int,
    height_px: int,
    width_mm: float,
    scale_ratio: int,
    unit: str = "m",
    *,
    dpi: float = 300.0,
    original_paper: str | None = None,
    height_mm: float | None = None,
    pdf_width_pt: float | None = None,
    pdf_height_pt: float | None = None,
    paper_size_name: str | None = None,
) -> AutoCalibration | None:
    if width_px <= 0 or scale_ratio <= 0:
        return None
    short_mm = min(width_mm, height_mm) if height_mm else width_mm
    long_mm = max(width_mm, height_mm) if height_mm else width_mm * (height_px / width_px)
    if original_paper:
        return compute_calibration_from_scale_declaration(
            width_px, height_px, dpi, scale_ratio, original_paper,
            unit=unit,
            physical_short_mm=short_mm, physical_long_mm=long_mm,
            pdf_width_pt=pdf_width_pt, pdf_height_pt=pdf_height_pt,
            paper_size_name=paper_size_name,
        )
    if width_mm <= 0:
        return None
    from app.pipeline.scale_converter import oriented_sheet_mm
    w_mm, h_mm = oriented_sheet_mm(width_px, height_px, short_mm, long_mm)
    real_width_m = (w_mm / 1000.0) * scale_ratio
    pixels_per_unit = width_px / real_width_m
    return AutoCalibration(
        pixels_per_unit=pixels_per_unit,
        unit=unit,
        scale_label=f"1:{scale_ratio}",
        width_mm=short_mm,
        height_mm=long_mm,
        paper_size=f"Scale 1:{scale_ratio}",
    )
