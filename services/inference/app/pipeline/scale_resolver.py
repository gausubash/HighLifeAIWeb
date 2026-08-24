"""Ordered scale resolution for blueprint pages.

Ported from BuildPro (packages/python-shared/src/buildpro_shared/scale_resolver.py).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.pipeline.blueprint import (
    compute_calibration_from_paper,
    compute_calibration_from_scale_declaration,
    compute_calibration_from_scale_ratio,
    parse_scale_and_paper,
    parse_scale_ratio,
)
from app.pipeline.scale_converter import infer_paper_dimensions_mm


@dataclass(frozen=True)
class ScaleResolution:
    pixels_per_unit: float
    unit: str
    method: str
    confidence: float
    scale_label: str | None = None


def resolve_from_paper(
    width_px: int,
    height_px: int,
    width_mm: float | None,
    height_mm: float | None,
    paper_size: str | None,
    *,
    dpi: float = 300.0,
    width_pt: float | None = None,
    height_pt: float | None = None,
) -> ScaleResolution | None:
    if dpi > 0 and width_px > 0 and height_px > 0:
        cal = compute_calibration_from_paper(
            width_px, height_px,
            width_pt or 0, height_pt or 0,
            unit="m", dpi=dpi,
        )
        if cal:
            return ScaleResolution(
                pixels_per_unit=cal.pixels_per_unit,
                unit=cal.unit,
                method="paper_size_auto",
                confidence=0.75,
                scale_label=cal.scale_label,
            )
    if not width_mm or not height_mm:
        return None
    width_m = width_mm / 1000.0
    if width_m <= 0:
        return None
    return ScaleResolution(
        pixels_per_unit=width_px / width_m,
        unit="m",
        method="paper_size_auto",
        confidence=0.6,
        scale_label=paper_size or "paper size",
    )


def resolve_from_text(
    scale_text: str,
    *,
    width_px: int,
    height_px: int,
    dpi: float = 300.0,
    physical_short_mm: float | None = None,
    physical_long_mm: float | None = None,
    pdf_width_pt: float | None = None,
    pdf_height_pt: float | None = None,
    paper_size_name: str | None = None,
) -> ScaleResolution | None:
    decl = parse_scale_and_paper(scale_text)
    if decl:
        scale, paper = decl
        cal = compute_calibration_from_scale_declaration(
            width_px, height_px, dpi, scale, paper,
            unit="m",
            physical_short_mm=physical_short_mm,
            physical_long_mm=physical_long_mm,
            pdf_width_pt=pdf_width_pt,
            pdf_height_pt=pdf_height_pt,
            paper_size_name=paper_size_name,
        )
        if cal:
            return ScaleResolution(
                pixels_per_unit=cal.pixels_per_unit,
                unit=cal.unit,
                method="title_block_text",
                confidence=0.95,
                scale_label=cal.scale_label,
            )
    ratio = parse_scale_ratio(scale_text)
    if ratio is None:
        return None

    short_mm = physical_short_mm
    long_mm = physical_long_mm
    if short_mm is None or long_mm is None:
        short_mm, long_mm = infer_paper_dimensions_mm(width_px, height_px, dpi)

    cal = compute_calibration_from_scale_ratio(
        width_px, height_px, short_mm, ratio,
        unit="m", dpi=dpi, height_mm=long_mm,
        pdf_width_pt=pdf_width_pt, pdf_height_pt=pdf_height_pt,
        paper_size_name=paper_size_name,
    )
    if cal:
        return ScaleResolution(
            pixels_per_unit=cal.pixels_per_unit,
            unit=cal.unit,
            method="title_block_text",
            confidence=0.7,
            scale_label=cal.scale_label,
        )
    return None


def resolve_scale_chain(
    *,
    width_px: int,
    height_px: int,
    width_mm: float | None,
    height_mm: float | None,
    paper_size: str | None,
    title_block_text: str | None = None,
    graphic_scale_px: float | None = None,
    graphic_known_m: float | None = None,
    dpi: float = 300.0,
    width_pt: float | None = None,
    height_pt: float | None = None,
) -> ScaleResolution | None:
    """Priority: title-block ``1:N @ AX`` -> graphic scale bar -> DPI paper fit."""
    physical_short = None
    physical_long = None
    if width_mm and height_mm:
        physical_short = min(width_mm, height_mm)
        physical_long = max(width_mm, height_mm)

    if title_block_text:
        resolved = resolve_from_text(
            title_block_text,
            width_px=width_px, height_px=height_px,
            dpi=dpi,
            physical_short_mm=physical_short,
            physical_long_mm=physical_long,
            pdf_width_pt=width_pt, pdf_height_pt=height_pt,
            paper_size_name=paper_size,
        )
        if resolved and resolved.pixels_per_unit > 0:
            return resolved

    if graphic_scale_px and graphic_known_m and graphic_known_m > 0:
        return ScaleResolution(
            pixels_per_unit=graphic_scale_px / graphic_known_m,
            unit="m",
            method="scale_bar_graphic",
            confidence=0.8,
            scale_label="graphic scale bar",
        )

    return resolve_from_paper(
        width_px, height_px,
        width_mm, height_mm,
        paper_size,
        dpi=dpi,
        width_pt=width_pt, height_pt=height_pt,
    )
