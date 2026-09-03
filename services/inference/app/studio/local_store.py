from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import uuid4

from PIL import Image

_lock = threading.Lock()


def studio_root() -> Path:
    override = os.environ.get("HIGHLIFE_STUDIO_DIR", "").strip()
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[2] / "data" / "studio"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    tmp.replace(path)


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def dataset_dir(dataset_id: str) -> Path:
    return studio_root() / "datasets" / dataset_id


def pages_dir(dataset_id: str) -> Path:
    return dataset_dir(dataset_id) / "pages"


def page_png_path(dataset_id: str, page_id: str) -> Path:
    return pages_dir(dataset_id) / f"{page_id}.png"


def page_json_path(dataset_id: str, page_id: str) -> Path:
    return pages_dir(dataset_id) / f"{page_id}.json"


def resolve_labels_path(dataset_id: str, page: dict[str, Any]) -> Path:
    linked = page.get("labels_path")
    if linked:
        return Path(str(linked))
    return page_json_path(dataset_id, page["id"])


def job_path(job_id: str) -> Path:
    return studio_root() / "jobs" / f"{job_id}.json"


def job_artifacts_dir(job_id: str) -> Path:
    path = studio_root() / "jobs" / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def model_dir(model_id: str) -> Path:
    return studio_root() / "models" / model_id


class StudioStoreError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _summarize(meta: dict[str, Any]) -> dict[str, Any]:
    pages = list(meta.get("pages") or [])
    labeled = [page for page in pages if int(page.get("shape_count") or 0) > 0]
    train_pages = [page for page in pages if str(page.get("split") or "train") == "train"]
    test_pages = [page for page in pages if str(page.get("split") or "train") == "test"]
    return {
        **meta,
        "image_count": len(pages),
        "labeled_count": len(labeled),
        "train_count": len(train_pages),
        "test_count": len(test_pages),
        "ready": any(
            int(page.get("shape_count") or 0) > 0 and str(page.get("split") or "train") == "train"
            for page in pages
        ),
        "storage_path": str(dataset_dir(meta["id"])),
    }


def _upgrade_north_pose_task(meta: dict[str, Any], path: Path | None = None) -> dict[str, Any]:
    from app.studio.model_catalog import CATEGORY_NORTH_ARROW, normalize_category

    cat = normalize_category(str(meta.get("category") or "") or None)
    if cat == CATEGORY_NORTH_ARROW and meta.get("task") != "pose":
        meta["task"] = "pose"
        if path is not None:
            meta["updated_at"] = _now()
            _write_json(path, meta)
    return meta


def list_datasets() -> list[dict[str, Any]]:
    root = studio_root() / "datasets"
    if not root.is_dir():
        return []
    items: list[dict[str, Any]] = []
    for meta_path in root.glob("*/meta.json"):
        try:
            items.append(_summarize(_upgrade_north_pose_task(_read_json(meta_path), meta_path)))
        except (OSError, json.JSONDecodeError):
            continue
    items.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
    return items


def get_dataset(dataset_id: str) -> dict[str, Any]:
    path = dataset_dir(dataset_id) / "meta.json"
    if not path.is_file():
        raise StudioStoreError("Dataset not found.", 404)
    return _summarize(_upgrade_north_pose_task(_read_json(path), path))


def update_dataset_class_names(dataset_id: str, class_names: list[str]) -> dict[str, Any]:
    from app.studio.dataset import parse_class_names

    names = parse_class_names(class_names)
    with _lock:
        path = dataset_dir(dataset_id) / "meta.json"
        if not path.is_file():
            raise StudioStoreError("Dataset not found.", 404)
        meta = _read_json(path)
        meta["class_names"] = names
        meta["updated_at"] = _now()
        _write_json(path, meta)
    return _summarize(meta)


def _stock_class_sets() -> list[set[str]]:
    from app.studio.model_catalog import DATASET_CATEGORY_DEFAULTS

    return [set(list(value.get("class_names") or [])) for value in DATASET_CATEGORY_DEFAULTS.values()]


def update_dataset_purpose(
    dataset_id: str,
    category: str,
    class_names: list[str] | None = None,
) -> dict[str, Any]:
    from app.studio.dataset import parse_class_names
    from app.studio.model_catalog import DATASET_CATEGORY_DEFAULTS, normalize_category

    cat = normalize_category((category or "").strip() or None)
    if not cat or cat not in DATASET_CATEGORY_DEFAULTS:
        raise StudioStoreError(f"Unknown dataset category: {category}", 400)
    defaults = DATASET_CATEGORY_DEFAULTS[cat]
    task = str(defaults.get("task") or "detect")
    default_names = list(defaults.get("class_names") or [])
    with _lock:
        path = dataset_dir(dataset_id) / "meta.json"
        if not path.is_file():
            raise StudioStoreError("Dataset not found.", 404)
        meta = _read_json(path)
        existing = [str(name) for name in (meta.get("class_names") or []) if str(name).strip()]
        if class_names:
            names = parse_class_names(class_names)
        elif not existing or set(existing) in _stock_class_sets():
            names = default_names
        else:
            from app.studio.dataset import foreign_stock_class_names, is_north_arrow_class

            foreign = foreign_stock_class_names(cat)
            names = list(default_names)
            for name in existing:
                key = " ".join(name.strip().lower().replace("_", " ").split())
                if name in names:
                    continue
                if name in foreign or key in foreign:
                    continue
                if cat == "north_arrow" and is_north_arrow_class(name):
                    continue
                names.append(name)
        meta["category"] = cat
        meta["task"] = task
        meta["class_names"] = names
        meta["updated_at"] = _now()
        _write_json(path, meta)
    return _summarize(meta)


def create_dataset(*, name: str, task: str, class_names: list[str], category: str | None = None) -> dict[str, Any]:
    cleaned = name.strip() or "Untitled dataset"
    if task not in {"detect", "segment", "pose"}:
        raise StudioStoreError("Task must be detect, segment, or pose.")
    if not class_names:
        raise StudioStoreError("Add at least one class name.")
    from app.studio.model_catalog import DATASET_CATEGORY_DEFAULTS, normalize_category

    cat = normalize_category((category or "").strip() or None)
    if category and not cat:
        raise StudioStoreError(f"Unknown dataset category: {category}")
    if cat and cat not in DATASET_CATEGORY_DEFAULTS:
        raise StudioStoreError(f"Unknown dataset category: {category}")
    if cat == "north_arrow":
        task = str(DATASET_CATEGORY_DEFAULTS[cat].get("task") or "pose")
    dataset_id = str(uuid4())
    meta = {
        "id": dataset_id,
        "name": cleaned,
        "task": task,
        "category": cat,
        "class_names": class_names,
        "pages": [],
        "created_at": _now(),
        "updated_at": _now(),
    }
    with _lock:
        pages_dir(dataset_id).mkdir(parents=True, exist_ok=True)
        _write_json(dataset_dir(dataset_id) / "meta.json", meta)
    return _summarize(meta)


def delete_dataset(dataset_id: str) -> None:
    import shutil

    path = dataset_dir(dataset_id)
    if not path.is_dir():
        raise StudioStoreError("Dataset not found.", 404)
    with _lock:
        shutil.rmtree(path, ignore_errors=True)


def delete_page(dataset_id: str, page_id: str) -> dict[str, Any]:
    """Remove a page shortcut from the dataset (does not delete the original file)."""
    with _lock:
        meta = _require_page_meta(dataset_id, page_id)
        page = next(item for item in meta["pages"] if item["id"] == page_id)
        meta["pages"] = [item for item in meta["pages"] if item["id"] != page_id]
        # Drop copied raster/labels if this was an uploaded (non-link) page.
        if not page.get("link"):
            png = page_png_path(dataset_id, page_id)
            if png.is_file():
                png.unlink()
            local_json = page_json_path(dataset_id, page_id)
            if local_json.is_file():
                local_json.unlink()
        meta["updated_at"] = _now()
        _write_json(dataset_dir(dataset_id) / "meta.json", meta)
        return _summarize(meta)


def is_tile_page(page: dict[str, Any]) -> bool:
    kind = str(page.get("kind") or "")
    name = str(page.get("source_name") or "")
    return kind == "tile" or "_tile" in name.lower()


def delete_dataset_tiles(dataset_id: str) -> dict[str, Any]:
    """Remove every generated tile page and its copied raster/labels."""
    with _lock:
        meta_path = dataset_dir(dataset_id) / "meta.json"
        if not meta_path.is_file():
            raise StudioStoreError("Dataset not found.", 404)
        meta = _read_json(meta_path)
        kept: list[dict[str, Any]] = []
        removed = 0
        for page in list(meta.get("pages") or []):
            if not is_tile_page(page):
                kept.append(page)
                continue
            if not page.get("link"):
                png = page_png_path(dataset_id, str(page.get("id") or ""))
                if png.is_file():
                    png.unlink()
                local_json = page_json_path(dataset_id, str(page.get("id") or ""))
                if local_json.is_file():
                    local_json.unlink()
            removed += 1
        meta["pages"] = kept
        meta["updated_at"] = _now()
        _write_json(meta_path, meta)
        summary = _summarize(meta)
        summary["tiles_removed"] = removed
        return summary


def _path_matches_source(page_source: str, source_name: str | None, target: str, raw: str) -> bool:
    if not page_source and source_name == raw:
        return True
    if page_source in {raw, target} or source_name == raw:
        return True
    try:
        resolved = str(Path(page_source).expanduser().resolve()) if page_source else ""
    except OSError:
        resolved = page_source
    if resolved in {raw, target}:
        return True
    # Folder link: drop every file under that root.
    for root in {raw, target}:
        if not root:
            continue
        prefix = root.rstrip("\\/")
        if resolved.startswith(prefix + "\\") or resolved.startswith(prefix + "/"):
            return True
        if page_source.startswith(prefix + "\\") or page_source.startswith(prefix + "/"):
            return True
    return False


def unlink_source(dataset_id: str, source_path: str) -> dict[str, Any]:
    """Remove every page linked from one source file/folder path (keeps originals on disk)."""
    raw = source_path.strip().strip('"')
    target = str(Path(raw).expanduser())
    try:
        target = str(Path(target).resolve())
    except OSError:
        pass
    with _lock:
        meta_path = dataset_dir(dataset_id) / "meta.json"
        if not meta_path.is_file():
            raise StudioStoreError("Dataset not found.", 404)
        meta = _read_json(meta_path)
        kept: list[dict[str, Any]] = []
        removed = 0
        for page in meta.get("pages") or []:
            page_source = str(page.get("source_path") or "")
            if _path_matches_source(page_source, page.get("source_name"), target, raw):
                removed += 1
                if not page.get("link"):
                    png = page_png_path(dataset_id, page["id"])
                    if png.is_file():
                        png.unlink()
                    local_json = page_json_path(dataset_id, page["id"])
                    if local_json.is_file():
                        local_json.unlink()
                continue
            kept.append(page)
        if removed == 0:
            raise StudioStoreError("No pages matched that source.", 404)
        meta["pages"] = kept
        linked = [
            path
            for path in (meta.get("linked_paths") or [])
            if path not in {raw, target, source_path}
        ]
        meta["linked_paths"] = linked
        meta["updated_at"] = _now()
        _write_json(meta_path, meta)
        summary = _summarize(meta)
        summary["removed_count"] = removed
        return summary


def set_page_split(dataset_id: str, page_id: str, split: str) -> dict[str, Any]:
    if split not in {"train", "test"}:
        raise StudioStoreError("Split must be train or test.")
    with _lock:
        meta = _require_page_meta(dataset_id, page_id)
        page = next(item for item in meta["pages"] if item["id"] == page_id)
        page["split"] = split
        meta["updated_at"] = _now()
        _write_json(dataset_dir(dataset_id) / "meta.json", meta)
        return page


def _png_bytes_and_size(image_bytes: bytes) -> tuple[bytes, int, int]:
    image = Image.open(BytesIO(image_bytes)).convert("RGB")
    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue(), image.width, image.height


def _pdf_page_basename(pdf_name: str, page_number: int) -> str:
    """Name converted pages as ``{pdf_stem}_{page}`` e.g. ``20_1.png``."""
    stem = Path(str(pdf_name)).stem
    # Avoid doubling if already ``20_1`` / ``20-p1``.
    for suffix in (f"_{page_number}", f"-p{page_number}"):
        if stem.lower().endswith(suffix.lower()):
            stem = stem[: -len(suffix)]
            break
    stem = stem or "page"
    return f"{stem}_{int(page_number)}.png"


def _pdf_stem_for_page(page: dict[str, Any]) -> str:
    """Prefer the original PDF filename (e.g. ``20.pdf``), not the stored uuid copy."""
    source_name = str(page.get("source_name") or "")
    display = str(page.get("display_path") or "")
    if source_name.lower().endswith(".pdf"):
        return Path(source_name).stem or "page"
    if display:
        return Path(display).stem or "page"
    source_path = str(page.get("source_path") or "")
    if source_path.lower().endswith(".pdf"):
        # Stored copies look like ``a1b2c3d4e5_20.pdf`` — strip uuid prefix when present.
        stem = Path(source_path).stem
        if "_" in stem:
            maybe_uuid, rest = stem.split("_", 1)
            if len(maybe_uuid) == 10 and rest:
                return rest
        return stem or "page"
    stem = Path(source_name or "page").stem
    page_number = int(page.get("page_number") or 1)
    for suffix in (f"_{page_number}", f"-p{page_number}"):
        if stem.lower().endswith(suffix.lower()):
            return stem[: -len(suffix)] or "page"
    return stem or "page"


def add_page(
    dataset_id: str,
    *,
    image_bytes: bytes,
    source_name: str,
    page_number: int,
    labels: dict[str, Any] | None = None,
    split: str = "train",
    source_path: str | None = None,
    kind: str = "image",
    dpi: int | None = None,
) -> dict[str, Any]:
    if split not in {"train", "test"}:
        raise StudioStoreError("Split must be train or test.")
    png, width, height = _png_bytes_and_size(image_bytes)
    page_id = str(uuid4())
    page: dict[str, Any] = {
        "id": page_id,
        "source_name": source_name,
        "source_path": source_path,
        "page_number": int(page_number),
        "width_px": width,
        "height_px": height,
        "split": split,
        "link": False,
        "kind": kind or "image",
        "labeled": False,
        "shape_count": 0,
    }
    if dpi is not None:
        page["dpi"] = int(dpi)
    with _lock:
        meta_path = dataset_dir(dataset_id) / "meta.json"
        if not meta_path.is_file():
            raise StudioStoreError("Dataset not found.", 404)
        meta = _read_json(meta_path)
        pages_dir(dataset_id).mkdir(parents=True, exist_ok=True)
        page_png_path(dataset_id, page_id).write_bytes(png)
        if labels:
            _write_labels_locked(dataset_id, page, labels, width, height)
        meta["pages"].append(page)
        meta["updated_at"] = _now()
        _write_json(meta_path, meta)
    return page


def _uploads_dir(dataset_id: str) -> Path:
    path = dataset_dir(dataset_id) / "uploads"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _clamp_dpi(dpi: int | float) -> int:
    value = int(dpi)
    if value < 72:
        return 72
    if value > 600:
        return 600
    return value


def _add_pdf_page_meta(
    dataset_id: str,
    *,
    pdf_path: Path,
    source_name: str,
    page_number: int,
    page_count: int,
    split: str,
    dpi: int,
    display_path: str | None,
    labels: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Index a stored PDF page without rasterizing yet (on-demand render)."""
    page_id = str(uuid4())
    page: dict[str, Any] = {
        "id": page_id,
        "source_name": source_name,
        "source_path": str(pdf_path),
        "display_path": display_path,
        "page_number": int(page_number),
        "page_count": int(page_count),
        "width_px": 0,
        "height_px": 0,
        "split": split,
        "link": False,
        "kind": "pdf",
        "dpi": int(dpi),
        "labeled": False,
        "shape_count": 0,
    }
    with _lock:
        meta_path = dataset_dir(dataset_id) / "meta.json"
        if not meta_path.is_file():
            raise StudioStoreError("Dataset not found.", 404)
        meta = _read_json(meta_path)
        if labels:
            # Labels need pixel size — render once to seed dimensions + write labels.
            from app.studio.link_path import render_pdf_page_png

            png, width, height = render_pdf_page_png(pdf_path, page_number, dpi=dpi)
            page["width_px"] = width
            page["height_px"] = height
            pages_dir(dataset_id).mkdir(parents=True, exist_ok=True)
            # Keep a cache raster so annotate is fast; still marked kind=pdf until convert.
            page_png_path(dataset_id, page_id).write_bytes(png)
            _write_labels_locked(dataset_id, page, labels, width, height)
        meta["pages"].append(page)
        meta["updated_at"] = _now()
        _write_json(meta_path, meta)
    return page


def ingest_uploaded_files(
    dataset_id: str,
    files: list[tuple[str, bytes]],
    *,
    split: str = "train",
    dpi: int = 300,
    convert_pdf: bool = True,
) -> dict[str, Any]:
    """Copy uploaded images/PDFs (+ optional LabelMe JSON) into the dataset.

    Images are stored as PNG pages. PDFs either rasterize at ``dpi`` (convert_pdf)
    or are kept as PDF pages for later conversion / on-demand render.
    """
    import tempfile

    from app.studio.link_path import IMAGE_SUFFIXES, PDF_SUFFIX, render_pdf_page_png

    if split not in {"train", "test"}:
        raise StudioStoreError("Split must be train or test.")
    if not files:
        raise StudioStoreError("No files in the upload.")
    dpi = _clamp_dpi(dpi)

    by_rel = {rel.replace("\\", "/"): data for rel, data in files if rel}
    labels_by_stem: dict[str, dict[str, Any]] = {}
    for rel, data in by_rel.items():
        path = Path(rel)
        if path.suffix.lower() != ".json":
            continue
        try:
            payload = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict) and isinstance(payload.get("shapes"), list):
            labels_by_stem[path.with_suffix("").as_posix().lower()] = payload

    added = 0
    pdf_pages = 0
    image_pages = 0
    media = [
        (rel, data)
        for rel, data in sorted(by_rel.items())
        if Path(rel).suffix.lower() in IMAGE_SUFFIXES | {PDF_SUFFIX}
    ]
    if not media:
        raise StudioStoreError("No PDFs or images found in that folder.")

    for rel, data in media:
        path = Path(rel)
        suffix = path.suffix.lower()
        stem_key = path.with_suffix("").as_posix().lower()
        labels = labels_by_stem.get(stem_key)

        if suffix == PDF_SUFFIX:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(data)
                tmp_path = Path(tmp.name)
            try:
                try:
                    import pypdfium2 as pdfium
                except ImportError as exc:
                    raise StudioStoreError(
                        "PDF upload needs pypdfium2. Install it in the inference venv.",
                        400,
                    ) from exc
                doc = pdfium.PdfDocument(str(tmp_path))
                try:
                    page_count = len(doc)
                finally:
                    doc.close()

                if convert_pdf:
                    for page_number in range(1, page_count + 1):
                        png, _, _ = render_pdf_page_png(tmp_path, page_number, dpi=dpi)
                        page_labels = labels_by_stem.get(f"{stem_key}-p{page_number}") or labels_by_stem.get(
                            f"{stem_key}_{page_number}"
                        )
                        image_name = _pdf_page_basename(path.name, page_number)
                        add_page(
                            dataset_id,
                            image_bytes=png,
                            source_name=image_name,
                            page_number=page_number,
                            labels=page_labels,
                            split=split,
                            source_path=rel,
                            kind="image",
                            dpi=dpi,
                        )
                        added += 1
                        pdf_pages += 1
                else:
                    stored = _uploads_dir(dataset_id) / f"{uuid4().hex[:10]}_{path.name}"
                    stored.write_bytes(data)
                    for page_number in range(1, page_count + 1):
                        page_labels = labels_by_stem.get(f"{stem_key}-p{page_number}") or labels_by_stem.get(
                            f"{stem_key}_{page_number}"
                        )
                        _add_pdf_page_meta(
                            dataset_id,
                            pdf_path=stored,
                            source_name=path.name,
                            page_number=page_number,
                            page_count=page_count,
                            split=split,
                            dpi=dpi,
                            display_path=rel,
                            labels=page_labels,
                        )
                        added += 1
                        pdf_pages += 1
            finally:
                tmp_path.unlink(missing_ok=True)
            continue

        add_page(
            dataset_id,
            image_bytes=data,
            source_name=path.name,
            page_number=1,
            labels=labels,
            split=split,
            source_path=rel,
            kind="image",
        )
        added += 1
        image_pages += 1

    summary = get_dataset(dataset_id)
    summary["added_count"] = added
    summary["pdf_page_count"] = pdf_pages
    summary["image_page_count"] = image_pages
    summary["dpi"] = dpi
    summary["convert_pdf"] = convert_pdf
    return summary


def convert_dataset_pdfs_to_images(
    dataset_id: str,
    *,
    dpi: int = 300,
    page_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Rasterize stored PDF pages into PNG images for annotation/training."""
    from app.studio.link_path import render_pdf_page_png

    dpi = _clamp_dpi(dpi)
    converted = 0
    with _lock:
        meta_path = dataset_dir(dataset_id) / "meta.json"
        if not meta_path.is_file():
            raise StudioStoreError("Dataset not found.", 404)
        meta = _read_json(meta_path)
        pages_dir(dataset_id).mkdir(parents=True, exist_ok=True)
        for page in meta.get("pages") or []:
            if page_ids is not None and page.get("id") not in page_ids:
                continue
            if str(page.get("kind") or "") != "pdf":
                continue
            source = Path(str(page.get("source_path") or ""))
            if not source.is_file():
                raise StudioStoreError(f"PDF missing for page {page.get('id')}: {source}", 404)
            page_number = int(page.get("page_number") or 1)
            png, width, height = render_pdf_page_png(source, page_number, dpi=dpi)
            page_id = str(page["id"])
            page_png_path(dataset_id, page_id).write_bytes(png)
            page["source_name"] = _pdf_page_basename(_pdf_stem_for_page(page), page_number)
            page["width_px"] = width
            page["height_px"] = height
            page["kind"] = "image"
            page["dpi"] = dpi
            page["converted_from_pdf"] = True
            # Keep labels if present; refresh imagePath dimensions.
            labels = read_page_labels(dataset_id, page)
            if labels and labels.get("shapes"):
                _write_labels_locked(dataset_id, page, labels, width, height)
            converted += 1
        if converted == 0:
            raise StudioStoreError("No PDF pages to convert. Upload a PDF with Convert off, or pick PDF pages.")
        meta["updated_at"] = _now()
        _write_json(meta_path, meta)
        summary = _summarize(meta)
        summary["converted_count"] = converted
        summary["dpi"] = dpi
        return summary


def replace_page_image(
    dataset_id: str,
    page_id: str,
    image_bytes: bytes,
) -> dict[str, Any]:
    with _lock:
        meta = _require_page_meta(dataset_id, page_id)
        page = next(item for item in meta["pages"] if item["id"] == page_id)
        if page.get("link"):
            raise StudioStoreError(
                "This page is a shortcut to a local file. Edit the original or unlink it instead of rewriting a copy.",
                400,
            )
        png, width, height = _png_bytes_and_size(image_bytes)
        page_png_path(dataset_id, page_id).write_bytes(png)
        page["width_px"] = width
        page["height_px"] = height
        meta["updated_at"] = _now()
        _write_json(dataset_dir(dataset_id) / "meta.json", meta)
        return page


def _require_page_meta(dataset_id: str, page_id: str) -> dict[str, Any]:
    meta_path = dataset_dir(dataset_id) / "meta.json"
    if not meta_path.is_file():
        raise StudioStoreError("Dataset not found.", 404)
    meta = _read_json(meta_path)
    if not any(page.get("id") == page_id for page in meta.get("pages") or []):
        raise StudioStoreError("Page not found.", 404)
    return meta


def _write_labels_locked(
    dataset_id: str,
    page: dict[str, Any],
    labels: dict[str, Any],
    width: int,
    height: int,
) -> None:
    shapes = list(labels.get("shapes") or [])
    json_path = resolve_labels_path(dataset_id, page)
    if not shapes:
        if json_path.is_file():
            json_path.unlink()
        page["shape_count"] = 0
        page["labeled"] = False
        return
    image_name = Path(str(page.get("source_path") or page.get("source_name") or f"{page['id']}.png")).name
    if str(page.get("kind") or "") == "pdf" or Path(image_name).suffix.lower() == ".pdf":
        image_name = _pdf_page_basename(image_name, int(page.get("page_number") or 1))
    elif Path(image_name).suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
        image_name = f"{Path(image_name).stem}.png"
    doc = {
        "version": labels.get("version") or "5.8.3",
        "flags": labels.get("flags") or {},
        "shapes": shapes,
        "imagePath": image_name,
        "imageData": None,
        "imageWidth": width,
        "imageHeight": height,
    }
    page["labels_path"] = str(json_path)
    _write_json(json_path, doc)
    page["shape_count"] = len(shapes)
    page["labeled"] = len(shapes) > 0


def save_labels(dataset_id: str, page_id: str, labels: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        meta = _require_page_meta(dataset_id, page_id)
        page = next(item for item in meta["pages"] if item["id"] == page_id)
        width = int(page.get("width_px") or labels.get("imageWidth") or 0)
        height = int(page.get("height_px") or labels.get("imageHeight") or 0)
        if width < 1 or height < 1:
            png, width, height = read_page_png(dataset_id, page)
            page["width_px"] = width
            page["height_px"] = height
        _write_labels_locked(dataset_id, page, labels, width, height)
        meta["updated_at"] = _now()
        _write_json(dataset_dir(dataset_id) / "meta.json", meta)
        return page


def _seed_shape_count(page: dict[str, Any]) -> None:
    labels_path = page.get("labels_path")
    if not labels_path:
        page["shape_count"] = 0
        page["labeled"] = False
        return
    path = Path(str(labels_path))
    if not path.is_file():
        page["shape_count"] = 0
        page["labeled"] = False
        return
    try:
        payload = _read_json(path)
        shapes = list(payload.get("shapes") or [])
    except (OSError, json.JSONDecodeError):
        shapes = []
    page["shape_count"] = len(shapes)
    page["labeled"] = len(shapes) > 0


def link_local_path(
    dataset_id: str,
    raw_path: str,
    *,
    split: str = "train",
) -> dict[str, Any]:
    """Index a local file/folder as shortcuts — no image/PDF bytes are copied."""
    from app.studio.link_path import discover_link_targets, iter_page_specs

    if split not in {"train", "test"}:
        raise StudioStoreError("Split must be train or test.")

    try:
        targets = discover_link_targets(raw_path)
    except FileNotFoundError as exc:
        raise StudioStoreError(str(exc), 404) from exc
    except RuntimeError as exc:
        raise StudioStoreError(str(exc), 400) from exc

    added: list[dict[str, Any]] = []
    with _lock:
        meta_path = dataset_dir(dataset_id) / "meta.json"
        if not meta_path.is_file():
            raise StudioStoreError("Dataset not found.", 404)
        meta = _read_json(meta_path)
        existing = {
            (str(page.get("source_path")), int(page.get("page_number") or 1))
            for page in meta.get("pages") or []
        }
        linked_roots = list(meta.get("linked_paths") or [])
        root = str(Path(raw_path.strip().strip('"')).expanduser().resolve())
        if root not in linked_roots:
            linked_roots.append(root)
        meta["linked_paths"] = linked_roots

        for target in targets:
            try:
                specs = iter_page_specs(target)
            except RuntimeError as exc:
                raise StudioStoreError(str(exc), 400) from exc
            for spec in specs:
                key = (spec["source_path"], int(spec["page_number"]))
                if key in existing:
                    continue
                page = {
                    "id": str(uuid4()),
                    "source_name": spec["source_name"],
                    "source_path": spec["source_path"],
                    "page_number": int(spec["page_number"]),
                    "width_px": int(spec.get("width_px") or 0),
                    "height_px": int(spec.get("height_px") or 0),
                    "labels_path": spec.get("labels_path"),
                    "kind": spec.get("kind") or "image",
                    "link": True,
                    "split": split,
                    "labeled": False,
                    "shape_count": 0,
                }
                _seed_shape_count(page)
                meta["pages"].append(page)
                existing.add(key)
                added.append(page)

        if not added and not meta.get("pages"):
            raise StudioStoreError(
                "No PDFs or images found at that path. Point at a folder of PDFs/PNGs, or a single file."
            )
        meta["updated_at"] = _now()
        _write_json(meta_path, meta)
        summary = _summarize(meta)
        summary["added_count"] = len(added)
        return summary


def read_page_png(dataset_id: str, page: dict[str, Any]) -> tuple[bytes, int, int]:
    """Return PNG bytes for a page — from linked source, stored PDF, or PNG copy."""
    from app.studio.link_path import render_pdf_page_png

    kind = str(page.get("kind") or "")
    source_path = page.get("source_path")
    dpi = float(page.get("dpi") or 300)

    if kind == "pdf" and source_path:
        source = Path(str(source_path))
        if not source.is_file():
            raise StudioStoreError(f"PDF missing: {source}", 404)
        return render_pdf_page_png(source, int(page.get("page_number") or 1), dpi=dpi)

    if page.get("link") and source_path:
        source = Path(str(source_path))
        if not source.is_file():
            raise StudioStoreError(f"Linked file missing: {source}", 404)
        if kind == "pdf" or source.suffix.lower() == ".pdf":
            return render_pdf_page_png(source, int(page.get("page_number") or 1), dpi=dpi)
        image = Image.open(source).convert("RGB")
        buf = BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue(), image.width, image.height

    path = page_png_path(dataset_id, page["id"])
    if path.is_file():
        image = Image.open(path).convert("RGB")
        buf = BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue(), image.width, image.height

    raise StudioStoreError("Page image not found.", 404)

def update_page_size(dataset_id: str, page_id: str, width: int, height: int) -> None:
    with _lock:
        meta = _require_page_meta(dataset_id, page_id)
        page = next(item for item in meta["pages"] if item["id"] == page_id)
        page["width_px"] = int(width)
        page["height_px"] = int(height)
        meta["updated_at"] = _now()
        _write_json(dataset_dir(dataset_id) / "meta.json", meta)


def read_page_labels(dataset_id: str, page: dict[str, Any]) -> dict[str, Any] | None:
    path = resolve_labels_path(dataset_id, page)
    if not path.is_file():
        return None
    try:
        payload = _read_json(path)
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def labeled_pages_dir(dataset_id: str, *, split: str | None = "train") -> Path:
    """Build a LabelMe folder for training (hardlinks to originals when possible)."""
    import shutil

    meta = get_dataset(dataset_id)
    labeled = [
        page
        for page in meta["pages"]
        if int(page.get("shape_count") or 0) > 0
        and (split is None or str(page.get("split") or "train") == split)
    ]
    # Prefer studio-generated training tiles when present (reviewed in Tiles tab).
    tile_pages = [page for page in labeled if str(page.get("kind") or "") == "tile"]
    if tile_pages:
        labeled = tile_pages
    if not labeled:
        raise StudioStoreError(
            "Label at least one training page before fine-tuning."
            if split == "train"
            else "Label at least one page first."
            if split is None
            else "No labelled pages for that split."
        )

    out = dataset_dir(dataset_id) / "_train_labelme"
    if out.exists():
        shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)

    for page in labeled:
        stem = Path(str(page["source_name"])).stem
        # Prefer ``20_1`` style names already on the page; else ``stem_page-id``.
        if "_" in stem and stem.rsplit("_", 1)[-1].isdigit():
            out_stem = stem
        else:
            out_stem = f"{stem}_{page['page_number']}-{page['id'][:8]}"
        png_out = out / f"{out_stem}.png"
        json_out = out / f"{out_stem}.json"
        png_bytes, width, height = read_page_png(dataset_id, page)
        # Prefer hardlink for linked raster images; otherwise write rendered/copied PNG.
        linked_image = page.get("link") and str(page.get("kind") or "") == "image" and page.get("source_path")
        if linked_image:
            src = Path(str(page["source_path"]))
            try:
                if png_out.exists():
                    png_out.unlink()
                os.link(src, png_out)
            except OSError:
                png_out.write_bytes(png_bytes)
        else:
            png_out.write_bytes(png_bytes)
        labels = read_page_labels(dataset_id, page) or {"shapes": []}
        labels = {
            **labels,
            "imagePath": png_out.name,
            "imageData": None,
            "imageWidth": labels.get("imageWidth") or width,
            "imageHeight": labels.get("imageHeight") or height,
        }
        _write_json(json_out, labels)
    return out


def _clip_labelme_shapes_to_tile(
    shapes: list[dict[str, Any]],
    *,
    x0: int,
    y0: int,
    tile_w: int,
    tile_h: int,
    canvas_w: int,
    canvas_h: int,
) -> list[dict[str, Any]]:
    """Clip LabelMe shapes into a tile; remap points into padded canvas pixel space."""
    out: list[dict[str, Any]] = []
    for shape in shapes:
        if not isinstance(shape, dict):
            continue
        points = shape.get("points") or []
        if not isinstance(points, list) or len(points) < 2:
            continue
        try:
            pts = [(float(p[0]), float(p[1])) for p in points]
        except (TypeError, ValueError, IndexError):
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        if max(xs) < x0 or min(xs) > x0 + tile_w or max(ys) < y0 or min(ys) > y0 + tile_h:
            continue
        local: list[list[float]] = []
        for px, py in pts:
            lx = min(float(canvas_w), max(0.0, px - x0))
            ly = min(float(canvas_h), max(0.0, py - y0))
            local.append([lx, ly])
        if len(local) < 2:
            continue
        lxs = [p[0] for p in local]
        lys = [p[1] for p in local]
        if max(lxs) - min(lxs) < 1.0 and max(lys) - min(lys) < 1.0:
            continue
        cloned = dict(shape)
        cloned["points"] = local
        out.append(cloned)
    return out


def create_dataset_tiles(
    dataset_id: str,
    *,
    tile_size: int = 640,
    overlap: float = 0.2,
    min_side: int | None = None,
    only_labeled: bool = False,
    replace_existing: bool = False,
    skip_unlabeled: bool = False,
) -> dict[str, Any]:
    """
    PDF/image pages → overlapping square tiles sized for fine-tune ``imgsz``.

    Adds new image pages (``kind=tile``) with LabelMe clipped when the source page
    already has labels. Skips pages that are already tiles.
    """
    from io import BytesIO

    import numpy as np

    from app.yolo.tiling import iter_tiles, should_tile

    size = max(64, int(tile_size))
    # Match train default: tile when max side ≥ ~2× tile (or explicit min_side).
    gate = int(min_side) if min_side is not None else max(size + 1, size * 2)
    overlap = min(0.9, max(0.0, float(overlap)))

    meta = get_dataset(dataset_id)
    pages = list(meta.get("pages") or [])
    sources = [
        page
        for page in pages
        if str(page.get("kind") or "image") not in {"pdf", "tile"}
        and "_tile" not in str(page.get("source_name") or "").lower()
    ]
    if only_labeled:
        sources = [page for page in sources if int(page.get("shape_count") or 0) > 0]
    if not sources:
        raise StudioStoreError(
            "No raster pages to tile. Convert PDFs to images first"
            + (" and label at least one page." if only_labeled else "."),
            400,
        )

    if replace_existing:
        delete_dataset_tiles(dataset_id)

    from app.studio.layout_crop import resolve_drawing_crop_xyxy

    created = 0
    skipped_small = 0
    skipped_no_drawing = 0
    full_page_fallback = 0
    skipped_unlabeled = 0
    labeled_tiles = 0
    for page in sources:
        try:
            png_bytes, _width, _height = read_page_png(dataset_id, page)
        except StudioStoreError:
            continue
        image = Image.open(BytesIO(png_bytes)).convert("RGB")
        w, h = image.size

        labels = None
        try:
            labels = read_page_labels(dataset_id, page)
        except StudioStoreError:
            labels = None
        shapes = list((labels or {}).get("shapes") or []) if labels else []
        rgb = np.asarray(image, dtype=np.uint8)
        crop_box = resolve_drawing_crop_xyxy(
            w,
            h,
            shapes=shapes,
            rgb=rgb,
            studio_infer=True,
        )
        if crop_box is None:
            crop_box = (0, 0, w, h)
            full_page_fallback += 1
        cx0, cy0, cx1, cy1 = crop_box
        crop_w = cx1 - cx0
        crop_h = cy1 - cy0
        if not should_tile(crop_h, crop_w, tile_size=size, min_side=gate):
            skipped_small += 1
            continue

        split = str(page.get("split") or "train")
        stem = Path(str(page.get("source_name") or page.get("id") or "page")).stem
        source_path = f"tiles/{stem}@{size}"

        for idx, tile in enumerate(iter_tiles(crop_h, crop_w, size, overlap)):
            tile_x0 = cx0 + tile.x0
            tile_y0 = cy0 + tile.y0
            tile_x1 = cx0 + tile.x1
            tile_y1 = cy0 + tile.y1
            crop = image.crop((tile_x0, tile_y0, tile_x1, tile_y1))
            canvas = Image.new("RGB", (size, size), (255, 255, 255))
            canvas.paste(crop, (0, 0))
            buf = BytesIO()
            canvas.save(buf, format="PNG")
            tile_labels = None
            if shapes:
                clipped = _clip_labelme_shapes_to_tile(
                    shapes,
                    x0=tile_x0,
                    y0=tile_y0,
                    tile_w=tile.width,
                    tile_h=tile.height,
                    canvas_w=size,
                    canvas_h=size,
                )
                if clipped:
                    tile_labels = {
                        "version": (labels or {}).get("version") or "5.0.1",
                        "flags": dict((labels or {}).get("flags") or {}),
                        "shapes": clipped,
                        "imagePath": f"{stem}_tile{idx:03d}.png",
                        "imageWidth": size,
                        "imageHeight": size,
                    }
            if skip_unlabeled and not tile_labels:
                skipped_unlabeled += 1
                continue
            add_page(
                dataset_id,
                image_bytes=buf.getvalue(),
                source_name=f"{stem}_tile{idx:03d}.png",
                page_number=idx + 1,
                labels=tile_labels,
                split=split,
                source_path=source_path,
                kind="tile",
            )
            created += 1
            if tile_labels:
                labeled_tiles += 1

    summary = get_dataset(dataset_id)
    summary["tiles_created"] = created
    summary["tiles_labeled"] = labeled_tiles
    summary["tiles_skipped_small"] = skipped_small
    summary["tiles_skipped_no_drawing"] = skipped_no_drawing
    summary["tiles_full_page_fallback"] = full_page_fallback
    summary["tiles_skipped_unlabeled"] = skipped_unlabeled
    summary["tile_size"] = size
    summary["tile_overlap"] = overlap
    summary["tile_min_side"] = gate
    return summary


def export_annotation_crops(
    dataset_id: str,
    *,
    class_labels: list[str] | None = None,
    page_ids: list[str] | None = None,
    selections: list[dict[str, Any]] | None = None,
    target_name: str | None = None,
    category: str | None = None,
    padding_frac: float = 0.25,
    min_side_px: int = 64,
    square: bool = True,
) -> dict[str, Any]:
    """
    Crop labelled regions into a new dataset for specialist fine-tune.

    Use ``class_labels`` to take every matching shape on the source pages, or
    ``selections`` for explicit LabelMe shapes (e.g. the current Annotate selection).
    """
    from app.studio.export_crops import (
        infer_crop_dataset_meta,
        norm_label,
        padded_crop_xyxy,
        remap_shape_to_crop,
        shape_bbox,
    )

    source = get_dataset(dataset_id)
    wanted = {norm_label(name) for name in (class_labels or []) if str(name).strip()}
    explicit = [item for item in (selections or []) if isinstance(item, dict)]
    if not wanted and not explicit:
        raise StudioStoreError("Choose at least one class, or select annotations to crop.", 400)

    page_filter = {str(pid) for pid in (page_ids or []) if str(pid).strip()}
    pages = [
        page
        for page in list(source.get("pages") or [])
        if str(page.get("kind") or "image") != "tile"
        and (not page_filter or str(page.get("id")) in page_filter)
    ]
    if not pages:
        raise StudioStoreError("No source pages to crop. Convert PDFs to images first.", 400)

    by_page: dict[str, list[dict[str, Any]]] = {}
    if explicit:
        for item in explicit:
            page_id = str(item.get("pageId") or item.get("page_id") or "").strip()
            if not page_id:
                continue
            points = item.get("points")
            if not isinstance(points, list) or not points:
                continue
            label = str(item.get("label") or "").strip() or "object"
            shape = {
                "label": label,
                "shape_type": str(item.get("shapeType") or item.get("shape_type") or "polygon"),
                "points": points,
                "group_id": None,
                "description": "",
                "flags": {},
            }
            by_page.setdefault(page_id, []).append(shape)

    crops: list[tuple[dict[str, Any], bytes, dict[str, Any]]] = []
    used_labels: set[str] = set()
    pages_used = 0
    skipped_empty = 0

    for page in pages:
        page_id = str(page.get("id"))
        shapes: list[dict[str, Any]] = []
        if page_id in by_page:
            shapes = list(by_page[page_id])
        elif wanted:
            try:
                labels = read_page_labels(dataset_id, page)
            except StudioStoreError:
                labels = None
            for shape in list((labels or {}).get("shapes") or []):
                if not isinstance(shape, dict):
                    continue
                if norm_label(str(shape.get("label") or "")) in wanted:
                    shapes.append(shape)
        if not shapes:
            skipped_empty += 1
            continue

        try:
            png_bytes, width, height = read_page_png(dataset_id, page)
        except StudioStoreError:
            skipped_empty += 1
            continue
        image = Image.open(BytesIO(png_bytes)).convert("RGB")
        img_w, img_h = image.size
        if img_w <= 0 or img_h <= 0:
            skipped_empty += 1
            continue

        split = str(page.get("split") or "train")
        stem = Path(str(page.get("source_name") or page.get("id") or "page")).stem
        page_crops = 0
        for idx, shape in enumerate(shapes):
            bbox = shape_bbox(list(shape.get("points") or []))
            if bbox is None:
                continue
            x0, y0, x1, y1 = padded_crop_xyxy(
                *bbox,
                image_w=img_w,
                image_h=img_h,
                padding_frac=padding_frac,
                min_side=min_side_px,
                square=square,
            )
            crop = image.crop((x0, y0, x1, y1))
            crop_w, crop_h = crop.size
            remapped = remap_shape_to_crop(shape, x0=x0, y0=y0, crop_w=crop_w, crop_h=crop_h)
            if remapped is None:
                continue
            label = str(remapped.get("label") or "object").strip() or "object"
            used_labels.add(label)
            buf = BytesIO()
            crop.save(buf, format="PNG")
            slug = "".join(ch if ch.isalnum() else "_" for ch in label).strip("_") or "label"
            crop_labels = {
                "version": "5.8.3",
                "flags": {},
                "shapes": [remapped],
                "imagePath": f"{stem}_{slug}_{idx:03d}.png",
                "imageWidth": crop_w,
                "imageHeight": crop_h,
            }
            crops.append(
                (
                    {
                        "source_name": f"{stem}_{slug}_{idx:03d}.png",
                        "page_number": page_crops + 1,
                        "split": split,
                        "source_path": f"crops/{stem}",
                    },
                    buf.getvalue(),
                    crop_labels,
                )
            )
            page_crops += 1
        if page_crops:
            pages_used += 1
        else:
            skipped_empty += 1

    if not crops:
        raise StudioStoreError(
            "No matching annotations to crop. Label the class on at least one page, or select overlays first.",
            400,
        )

    inferred_cat, inferred_task = infer_crop_dataset_meta(
        sorted(used_labels),
        str(source.get("category") or "") or None,
        str(source.get("task") or "") or None,
    )
    target_category = (category or "").strip() or inferred_cat
    class_names = sorted(used_labels) or list(wanted) or ["object"]
    source_name = str(source.get("name") or "dataset")
    label_part = ", ".join(class_names[:3])
    if len(class_names) > 3:
        label_part += "…"
    name = (target_name or "").strip() or f"{source_name} — {label_part} crops"

    created = create_dataset(
        name=name,
        task=inferred_task,
        class_names=class_names,
        category=target_category,
    )
    for meta, image_bytes, labels in crops:
        add_page(
            created["id"],
            image_bytes=image_bytes,
            source_name=meta["source_name"],
            page_number=int(meta["page_number"]),
            labels=labels,
            split=str(meta["split"]),
            source_path=str(meta["source_path"]),
            kind="image",
        )

    summary = get_dataset(created["id"])
    summary["source_dataset_id"] = dataset_id
    summary["crops_created"] = len(crops)
    summary["pages_used"] = pages_used
    summary["skipped_empty"] = skipped_empty
    return summary


def convert_dataset_to_yolo(dataset_id: str) -> dict[str, Any]:
    """Materialise LabelMe pages and convert to Ultralytics YOLO layout on this PC."""
    import shutil

    from app.yolo.convert_labelme import convert_labelme_dir

    from app.studio.dataset import class_names_for_training, effective_train_task

    meta = get_dataset(dataset_id)
    class_names = class_names_for_training(meta)
    task = effective_train_task(meta)
    if not class_names:
        raise StudioStoreError("Dataset has no class names.")

    labeled = [
        page for page in meta["pages"] if int(page.get("shape_count") or 0) > 0
    ]
    tile_pages = [page for page in labeled if str(page.get("kind") or "") == "tile"]
    if tile_pages:
        labeled = tile_pages
    if not labeled:
        raise StudioStoreError("Label at least one page before converting to YOLO.")

    # Include train + test labelled pages so conversion mirrors what you annotated.
    src = labeled_pages_dir(dataset_id, split=None)
    out = dataset_dir(dataset_id) / "_yolo_export"
    if out.exists():
        shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)

    try:
        stats = convert_labelme_dir(
            src,
            out,
            fold=None,
            class_names=class_names,
            task=task,
        )
    except (FileNotFoundError, ValueError, OSError) as exc:
        raise StudioStoreError(str(exc), 400) from exc

    issues: list[str] = []
    if stats.skipped_labels:
        skipped = ", ".join(
            f"{name}×{count}" for name, count in sorted(stats.skipped_labels.items())
        )
        issues.append(
            f"Skipped unknown LabelMe labels (not in dataset classes): {skipped}. "
            "Rename shapes in Annotate to match the legend, or add those class names."
        )
    if stats.empty_pages:
        issues.append(
            f"{stats.empty_pages} page(s) had shapes but none converted "
            "(bad geometry or all labels unknown)."
        )
    if stats.images == 0:
        raise StudioStoreError(
            "Conversion produced no YOLO images. "
            + (" ".join(issues) if issues else "Check LabelMe class names and polygons."),
            400,
        )

    return {
        "ok": True,
        "dataset_id": dataset_id,
        "task": task,
        "path": str(out),
        "data_yaml": str(out / "data.yaml"),
        "images": stats.images,
        "instances": stats.instances,
        "train": stats.train,
        "val": stats.val,
        "empty_pages": stats.empty_pages,
        "total_json": stats.total_json,
        "skipped_labels": stats.skipped_labels,
        "issues": issues,
        "ready": stats.images > 0 and stats.val > 0,
    }


def list_jobs() -> list[dict[str, Any]]:
    root = studio_root() / "jobs"
    if not root.is_dir():
        return []
    items: list[dict[str, Any]] = []
    for path in root.glob("*.json"):
        try:
            items.append(_read_json(path))
        except (OSError, json.JSONDecodeError):
            continue
    items.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    return items


def get_job(job_id: str) -> dict[str, Any]:
    path = job_path(job_id)
    if not path.is_file():
        raise StudioStoreError("Training job not found.", 404)
    return _read_json(path)


def create_job(payload: dict[str, Any]) -> dict[str, Any]:
    job_id = str(uuid4())
    job = {
        "id": job_id,
        "status": "queued",
        "progress": 0,
        "metrics": None,
        "metrics_history": [],
        "preview_epoch": None,
        "preview_updated_at": None,
        "log_tail": "Queued on this PC.",
        "error": None,
        "output_model_id": None,
        "created_at": _now(),
        "started_at": None,
        "finished_at": None,
        **payload,
    }
    with _lock:
        job_artifacts_dir(job_id)
        _write_json(job_path(job_id), job)
    return job


def patch_job(job_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        job = get_job(job_id)
        job.update(patch)
        _write_json(job_path(job_id), job)
        return job


def delete_job(job_id: str) -> None:
    """Remove a job record and artifacts. Allowed for stuck running/queued jobs too."""
    import shutil

    path = job_path(job_id)
    if not path.is_file():
        raise StudioStoreError("Training job not found.", 404)
    with _lock:
        path.unlink(missing_ok=True)
        artifacts = studio_root() / "jobs" / job_id
        if artifacts.is_dir():
            shutil.rmtree(artifacts, ignore_errors=True)


def list_models() -> list[dict[str, Any]]:
    root = studio_root() / "models"
    if not root.is_dir():
        return []
    items: list[dict[str, Any]] = []
    for path in root.glob("*/meta.json"):
        try:
            items.append(_read_json(path))
        except (OSError, json.JSONDecodeError):
            continue
    items.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    return items


def get_model(model_id: str) -> dict[str, Any]:
    path = model_dir(model_id) / "meta.json"
    if not path.is_file():
        raise StudioStoreError("Model not found.", 404)
    return _read_json(path)


def delete_model(model_id: str) -> None:
    import shutil

    folder = model_dir(model_id)
    if not folder.is_dir():
        raise StudioStoreError("Model not found.", 404)
    with _lock:
        model = get_model(model_id)
        if model.get("is_active"):
            set_active_model(None)
        shutil.rmtree(folder, ignore_errors=True)


def save_model(*, weights: bytes, meta: dict[str, Any], filename: str = "best.pt") -> dict[str, Any]:
    model_id = str(meta.get("id") or uuid4())
    row = {**meta, "id": model_id, "created_at": meta.get("created_at") or _now()}
    weight_name = Path(filename).name or "best.pt"
    with _lock:
        folder = model_dir(model_id)
        folder.mkdir(parents=True, exist_ok=True)
        weight_path = folder / weight_name
        weight_path.write_bytes(weights)
        # Keep a studio_meta sidecar next to .h5 when training wrote one into bytes-only save.
        row["storage_path"] = str(weight_path)
        _write_json(folder / "meta.json", row)
    return row


def set_active_model(model_id: str | None) -> None:
    with _lock:
        for model in list_models():
            active = model_id is not None and model["id"] == model_id
            if bool(model.get("is_active")) == active:
                continue
            model["is_active"] = active
            _write_json(model_dir(model["id"]) / "meta.json", model)


def get_active_model() -> dict[str, Any] | None:
    for model in list_models():
        if model.get("is_active"):
            return model
    return None


def model_weights_path(model_id: str) -> Path:
    folder = model_dir(model_id)
    for name in ("best.h5", "best.pt"):
        path = folder / name
        if path.is_file():
            return path
    # Fall back to storage_path from meta when custom filenames were used.
    try:
        meta = get_model(model_id)
        stored = Path(str(meta.get("storage_path") or ""))
        if stored.is_file():
            return stored
    except StudioStoreError:
        pass
    raise StudioStoreError(f"Weights missing for model {model_id}.", 404)
