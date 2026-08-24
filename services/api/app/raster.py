from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import fitz
from PIL import Image

PREVIEW_MAX_EDGE = 512


@dataclass(frozen=True)
class RasterPage:
    page_number: int
    width_px: int
    height_px: int
    dpi: int
    raster_png: bytes
    preview_png: bytes


class PageRasterizer(ABC):
    """Replaceable page rasterisation (PDF/image → PNG). No OCR/CV."""

    @abstractmethod
    def rasterize(
        self,
        source: Path,
        mime_type: str,
        *,
        dpi: int,
        preview_max_edge: int = PREVIEW_MAX_EDGE,
    ) -> list[RasterPage]:
        raise NotImplementedError


def png_preview(raster_png: bytes, max_edge: int = PREVIEW_MAX_EDGE) -> bytes:
    image = Image.open(BytesIO(raster_png)).convert("RGB")
    w, h = image.size
    longest = max(w, h)
    if longest > max_edge:
        scale = max_edge / longest
        image = image.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    out = BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


class PyMuPdfRasterizer(PageRasterizer):
    def rasterize(
        self,
        source: Path,
        mime_type: str,
        *,
        dpi: int,
        preview_max_edge: int = PREVIEW_MAX_EDGE,
    ) -> list[RasterPage]:
        mime = mime_type.split(";")[0].strip().lower()
        if mime == "image/jpg":
            mime = "image/jpeg"
        if mime == "application/pdf":
            return self._pdf(source, dpi=dpi, preview_max_edge=preview_max_edge)
        if mime in {"image/png", "image/jpeg", "image/webp"}:
            return self._image(source, dpi=dpi, preview_max_edge=preview_max_edge)
        raise ValueError(f"Unsupported mime type: {mime}")

    def _pdf(self, source: Path, *, dpi: int, preview_max_edge: int) -> list[RasterPage]:
        doc = fitz.open(source)
        try:
            pages: list[RasterPage] = []
            for index, page in enumerate(doc, start=1):
                pix = page.get_pixmap(dpi=dpi, alpha=False)
                raster_png = pix.tobytes("png")
                pages.append(
                    RasterPage(
                        page_number=index,
                        width_px=pix.width,
                        height_px=pix.height,
                        dpi=dpi,
                        raster_png=raster_png,
                        preview_png=png_preview(raster_png, preview_max_edge),
                    )
                )
            return pages
        finally:
            doc.close()

    def _image(self, source: Path, *, dpi: int, preview_max_edge: int) -> list[RasterPage]:
        image = Image.open(source).convert("RGB")
        out = BytesIO()
        image.save(out, format="PNG")
        raster_png = out.getvalue()
        w, h = image.size
        return [
            RasterPage(
                page_number=1,
                width_px=w,
                height_px=h,
                dpi=dpi,
                raster_png=raster_png,
                preview_png=png_preview(raster_png, preview_max_edge),
            )
        ]


def get_rasterizer() -> PageRasterizer:
    return PyMuPdfRasterizer()
