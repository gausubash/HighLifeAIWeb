"""HighLife-style scale conversion: DPI render + A-series paper + effective scale.

Ported from BuildPro (packages/python-shared/src/buildpro_shared/scale_converter.py).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

MM_PER_INCH = 25.4

A_PAPER_SIZES_MM: dict[str, tuple[int, int]] = {
    "A0": (841, 1189),
    "A1": (594, 841),
    "A2": (420, 594),
    "A3": (297, 420),
    "A4": (210, 297),
    "A5": (148, 210),
}

_SCALE_PAPER_RE = re.compile(
    r"(?i)(?:scale\s*[:=]?\s*)?(?:[1lI|]\s*[:/\-．.]\s*)(?P<scale>\d{1,5})"
    r"(?:\s*[@©]\s*|\s+)(?:iso\s*)?(?P<paper>[ab]\s*[0-5])[a-z]?"
)

_SCALE_RATIO_ONLY_RE = re.compile(
    r"(?i)(?:scale\s*[:=]?\s*)?(?:[1lI|]\s*[:/\-．.]\s*)(?P<scale>\d{1,5})\b"
)


def normalize_ocr_scale_text(text: str) -> str:
    import unicodedata
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text)
    t = (
        t.replace("：", ":")
        .replace("／", "/")
        .replace("－", "-")
        .replace("．", ".")
        .replace("×", "x")
    )
    t = re.sub(r"(?i)(?<![0-9a-z])[lI|]\s*[:/]", "1:", t)
    t = re.sub(
        r"(?i)(scale\s*[:=]?\s*)1\s*[.\-]\s*(\d{2,5})\b",
        r"\g<1>1:\2",
        t,
    )
    t = re.sub(
        r"(?i)\b1\s*[.\-]\s*(\d{2,5})\s*([@©]|\bA\s*[0-5]\b)",
        r"1:\1 \2",
        t,
    )
    t = re.sub(r"(?i)\b([AB])\s*([0-5])[A-Za-z.]?\b", r"\1\2", t)
    t = re.sub(r"[ \t]+", " ", t)
    return t


def normalize_paper_code(paper: str | None) -> str | None:
    if not paper:
        return None
    code = paper.upper().strip().replace("ISO ", "").replace(" ", "")
    m = re.match(r"^([AB][0-5])", code)
    if m and m.group(1) in A_PAPER_SIZES_MM:
        return m.group(1)
    if code in A_PAPER_SIZES_MM:
        return code
    if len(code) >= 2 and code[0] in "AB" and code[1:].isdigit():
        return code
    return None


def parse_scale_and_paper(text: str) -> tuple[int, str] | None:
    if not text:
        return None
    normalized = normalize_ocr_scale_text(text)
    candidates = [
        text,
        normalized,
        re.sub(r"\s+", " ", normalized),
        re.sub(r"\s*@\s*", "@", normalized),
        normalized.replace(" ", ""),
    ]
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        match = _SCALE_PAPER_RE.search(candidate)
        if not match:
            continue
        scale = int(match.group("scale"))
        paper = normalize_paper_code(match.group("paper"))
        if paper and 1 <= scale <= 10000:
            return scale, paper
    return None


def parse_scale_ratio_from_text(text: str) -> int | None:
    if not text:
        return None
    decl = parse_scale_and_paper(text)
    if decl:
        return decl[0]
    normalized = normalize_ocr_scale_text(text)
    best: int | None = None
    for candidate in (text, normalized):
        for match in _SCALE_RATIO_ONLY_RE.finditer(candidate):
            scale = int(match.group("scale"))
            if 5 <= scale <= 10000:
                if best is None or scale > best:
                    best = scale
    return best


def is_landscape(width_px: int, height_px: int) -> bool:
    return width_px > height_px


def oriented_sheet_mm(
    width_px: int, height_px: int, short_mm: float, long_mm: float,
) -> tuple[float, float]:
    if width_px >= height_px:
        return long_mm, short_mm
    return short_mm, long_mm


def compute_effective_render_dpi(
    width_px: int, height_px: int, short_mm: float, long_mm: float,
) -> float:
    if width_px <= 0 or height_px <= 0 or short_mm <= 0 or long_mm <= 0:
        return 300.0
    w_mm, h_mm = oriented_sheet_mm(width_px, height_px, short_mm, long_mm)
    dpi_w = width_px * MM_PER_INCH / w_mm
    dpi_h = height_px * MM_PER_INCH / h_mm
    return (dpi_w + dpi_h) / 2.0


def paper_code_from_name(paper_name: str | None) -> str | None:
    return normalize_paper_code(paper_name)


def resolve_target_paper_code(
    *,
    width_px: int,
    height_px: int,
    dpi: float,
    pdf_width_pt: float | None = None,
    pdf_height_pt: float | None = None,
    paper_size_name: str | None = None,
    short_mm: float | None = None,
    long_mm: float | None = None,
) -> str | None:
    from app.pipeline.blueprint import match_paper_size

    if pdf_width_pt and pdf_height_pt and pdf_width_pt > 0 and pdf_height_pt > 0:
        pdf_match = match_paper_size(pdf_width_pt, pdf_height_pt)
        if pdf_match:
            code = paper_code_from_name(pdf_match.name)
            if code:
                return code

    code = paper_code_from_name(paper_size_name)
    if code:
        return code

    if short_mm and long_mm:
        dims = sorted([round(short_mm), round(long_mm)])
        for paper_code, (s, lng) in A_PAPER_SIZES_MM.items():
            if dims == [s, lng]:
                return paper_code

    return infer_paper_size_from_pixels(width_px, height_px, dpi)


def pixels_to_mm(pixels: float, dpi: float) -> float:
    return pixels * (MM_PER_INCH / dpi)


def infer_paper_size_from_pixels(
    width_px: int, height_px: int, dpi: float, *, tolerance_mm: int = 12,
) -> str | None:
    if width_px <= 0 or height_px <= 0 or dpi <= 0:
        return None
    width_mm = round(pixels_to_mm(width_px, dpi))
    height_mm = round(pixels_to_mm(height_px, dpi))
    dims = sorted([width_mm, height_mm])
    best: str | None = None
    best_delta = tolerance_mm + 1
    for code, (short, long) in A_PAPER_SIZES_MM.items():
        delta = abs(dims[0] - short) + abs(dims[1] - long)
        if delta <= tolerance_mm and delta < best_delta:
            best_delta = delta
            best = code
    return best


def infer_paper_dimensions_mm(
    width_px: int, height_px: int, dpi: float,
) -> tuple[float, float]:
    w_mm = pixels_to_mm(width_px, dpi)
    h_mm = pixels_to_mm(height_px, dpi)
    return round(min(w_mm, h_mm), 1), round(max(w_mm, h_mm), 1)


@dataclass(frozen=True)
class ScaleConversionInfo:
    original_scale: int
    original_paper: str
    target_paper: str
    dpi: float
    effective_scale: float
    scale_factor: float
    pixels_per_unit: float
    unit: str


class ScaleConverter:
    """Converts pixel measurements using drawing scale and paper-size correction."""

    def __init__(self, original_scale: int, original_paper_size: str, dpi: float):
        self.original_scale = int(original_scale)
        self.original_paper_size = normalize_paper_code(original_paper_size) or original_paper_size.upper()
        self.dpi = float(dpi)
        if self.original_paper_size not in A_PAPER_SIZES_MM:
            raise ValueError(f"Paper size must be one of: {list(A_PAPER_SIZES_MM.keys())}")

    @staticmethod
    def _paper_index(paper_size: str) -> int:
        code = normalize_paper_code(paper_size) or paper_size.upper()
        return int(code[1])

    def calculate_scale_factor(self, target_paper_size: str) -> float:
        target = normalize_paper_code(target_paper_size) or target_paper_size.upper()
        if target not in A_PAPER_SIZES_MM:
            raise ValueError(f"Paper size must be one of: {list(A_PAPER_SIZES_MM.keys())}")
        steps = self._paper_index(target) - self._paper_index(self.original_paper_size)
        return math.sqrt(2) ** steps

    def get_effective_scale(self, target_paper_size: str) -> float:
        return self.original_scale * self.calculate_scale_factor(target_paper_size)

    def pixel_to_real_mm(self, pixels: float, target_paper_size: str) -> float:
        mm_on_paper = pixels_to_mm(pixels, self.dpi)
        return mm_on_paper * self.get_effective_scale(target_paper_size)

    def pixel_to_real_m(self, pixels: float, target_paper_size: str) -> float:
        return self.pixel_to_real_mm(pixels, target_paper_size) / 1000.0

    def pixels_per_unit(self, target_paper_size: str, unit: str = "m") -> float:
        mm_per_px = MM_PER_INCH / self.dpi
        effective = self.get_effective_scale(target_paper_size)
        real_mm_per_px = mm_per_px * effective
        if unit == "mm":
            return 1.0 / real_mm_per_px if real_mm_per_px > 0 else 0.0
        if unit == "m":
            real_m_per_px = real_mm_per_px / 1000.0
            return 1.0 / real_m_per_px if real_m_per_px > 0 else 0.0
        raise ValueError("Unit must be 'mm' or 'm'")

    def conversion_info(self, target_paper_size: str, unit: str = "m") -> ScaleConversionInfo:
        target = normalize_paper_code(target_paper_size) or target_paper_size.upper()
        factor = self.calculate_scale_factor(target)
        effective = self.get_effective_scale(target)
        return ScaleConversionInfo(
            original_scale=self.original_scale,
            original_paper=self.original_paper_size,
            target_paper=target,
            dpi=self.dpi,
            effective_scale=effective,
            scale_factor=factor,
            pixels_per_unit=self.pixels_per_unit(target, unit),
            unit=unit,
        )


def build_calibration_from_scale_declaration(
    *,
    width_px: int,
    height_px: int,
    dpi: float,
    original_scale: int,
    original_paper: str,
    target_paper: str | None = None,
    unit: str = "m",
    physical_short_mm: float | None = None,
    physical_long_mm: float | None = None,
    pdf_width_pt: float | None = None,
    pdf_height_pt: float | None = None,
    paper_size_name: str | None = None,
) -> ScaleConversionInfo | None:
    orig = normalize_paper_code(original_paper)
    if not orig or original_scale <= 0 or dpi <= 0:
        return None

    short_mm = physical_short_mm
    long_mm = physical_long_mm
    if short_mm is None or long_mm is None:
        short_mm, long_mm = infer_paper_dimensions_mm(width_px, height_px, dpi)

    target = normalize_paper_code(target_paper) if target_paper else resolve_target_paper_code(
        width_px=width_px, height_px=height_px, dpi=dpi,
        pdf_width_pt=pdf_width_pt, pdf_height_pt=pdf_height_pt,
        paper_size_name=paper_size_name,
        short_mm=short_mm, long_mm=long_mm,
    )
    if not target:
        target = orig

    effective_dpi = dpi
    if physical_short_mm and physical_long_mm:
        effective_dpi = compute_effective_render_dpi(
            width_px, height_px, physical_short_mm, physical_long_mm
        )

    try:
        converter = ScaleConverter(original_scale, orig, effective_dpi)
        return converter.conversion_info(target, unit)
    except ValueError:
        return None
