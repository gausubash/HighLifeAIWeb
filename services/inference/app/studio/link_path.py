from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
PDF_SUFFIX = ".pdf"


def _pdf_page_count(path: Path) -> int:
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise RuntimeError(
            "PDF linking needs pypdfium2. Install it in the inference venv: pip install pypdfium2"
        ) from exc
    doc = pdfium.PdfDocument(str(path))
    try:
        return len(doc)
    finally:
        doc.close()


def normalized_crop_to_pdfium_crop(
    crop: dict[str, float],
    page_width_pt: float,
    page_height_pt: float,
) -> tuple[float, float, float, float]:
    """Map top-left normalized crop to PDFium ``(left, bottom, right, top)`` in points."""
    x0 = float(crop["x"]) * page_width_pt
    x1 = (float(crop["x"]) + float(crop["width"])) * page_width_pt
    y_top = float(crop["y"]) * page_height_pt
    y_bottom = (float(crop["y"]) + float(crop["height"])) * page_height_pt
    bottom = page_height_pt - y_bottom
    top = page_height_pt - y_top
    return (x0, bottom, x1, top)


def render_pdf_page_region_png(
    path: Path,
    page_number: int,
    crop: dict[str, float],
    *,
    dpi: float = 300,
    scale: float | None = None,
) -> tuple[bytes, int, int]:
    """Render only a normalized crop of a PDF page (much faster than full-page raster + crop)."""
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise RuntimeError(
            "PDF rendering needs pypdfium2. Install it in the inference venv: pip install pypdfium2"
        ) from exc
    render_scale = scale if scale is not None else max(float(dpi), 36.0) / 72.0
    doc = pdfium.PdfDocument(str(path))
    try:
        index = page_number - 1
        if index < 0 or index >= len(doc):
            raise ValueError(f"PDF page {page_number} out of range for {path.name}")
        page = doc[index]
        width_pt, height_pt = page.get_size()
        crop_box = normalized_crop_to_pdfium_crop(crop, width_pt, height_pt)
        bitmap = page.render(scale=render_scale, crop=crop_box)
        pil = bitmap.to_pil().convert("RGB")
        buf = BytesIO()
        pil.save(buf, format="PNG")
        return buf.getvalue(), pil.width, pil.height
    finally:
        doc.close()


def render_pdf_page_png(
    path: Path,
    page_number: int,
    *,
    dpi: float = 300,
    scale: float | None = None,
) -> tuple[bytes, int, int]:
    """Render 1-based PDF page to PNG bytes at the given DPI (or explicit scale)."""
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise RuntimeError(
            "PDF rendering needs pypdfium2. Install it in the inference venv: pip install pypdfium2"
        ) from exc
    render_scale = scale if scale is not None else max(float(dpi), 36.0) / 72.0
    doc = pdfium.PdfDocument(str(path))
    try:
        index = page_number - 1
        if index < 0 or index >= len(doc):
            raise ValueError(f"PDF page {page_number} out of range for {path.name}")
        page = doc[index]
        bitmap = page.render(scale=render_scale)
        pil = bitmap.to_pil().convert("RGB")
        buf = BytesIO()
        pil.save(buf, format="PNG")
        return buf.getvalue(), pil.width, pil.height
    finally:
        doc.close()


def image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.size


def default_labels_path(source: Path, page_number: int = 1) -> Path:
    if source.suffix.lower() == PDF_SUFFIX:
        return source.with_name(f"{source.stem}-p{page_number}.json")
    return source.with_suffix(".json")


def discover_link_targets(raw: str) -> list[Path]:
    path = Path(raw.strip().strip('"')).expanduser()
    if not path.exists():
        raise FileNotFoundError(f"Path not found on this PC: {path}")
    path = path.resolve()
    if path.is_file():
        return [path]
    if not path.is_dir():
        raise FileNotFoundError(f"Not a file or folder: {path}")
    files = sorted(
        p
        for p in path.rglob("*")
        if p.is_file()
        and not p.name.startswith(".")
        and p.suffix.lower() in IMAGE_SUFFIXES | {PDF_SUFFIX, ".json"}
    )
    # Prefer pairing: keep images/pdfs; json alone with imageData is handled later
    return files


def iter_page_specs(path: Path) -> list[dict]:
    """Build page shortcut specs for one file (no bytes copied)."""
    suffix = path.suffix.lower()
    if suffix == PDF_SUFFIX:
        count = _pdf_page_count(path)
        pages: list[dict] = []
        for page_number in range(1, count + 1):
            labels = default_labels_path(path, page_number)
            pages.append(
                {
                    "source_name": path.name,
                    "source_path": str(path),
                    "page_number": page_number,
                    "labels_path": str(labels) if labels.is_file() else str(labels),
                    "kind": "pdf",
                }
            )
        return pages
    if suffix in IMAGE_SUFFIXES:
        labels = default_labels_path(path)
        width, height = image_size(path)
        return [
            {
                "source_name": path.name,
                "source_path": str(path),
                "page_number": 1,
                "labels_path": str(labels),
                "width_px": width,
                "height_px": height,
                "kind": "image",
            }
        ]
    if suffix == ".json":
        # LabelMe JSON with imageData or sibling image — skip bare JSON here;
        # image+json pairs are covered when the image is indexed.
        return []
    return []
