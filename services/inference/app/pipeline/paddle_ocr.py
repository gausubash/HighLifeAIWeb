"""Local PaddleOCR sheet text extraction (runs in .venv-ocr / Python 3.10–3.12)."""

from __future__ import annotations

import atexit
import json
import logging
import os
import re
import subprocess
import tempfile
import threading
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from app.config import Settings, get_settings
from app.pipeline.scale_converter import (
    format_scale_declaration,
    normalize_ocr_scale_text,
    parse_paper_from_text,
    parse_scale_and_paper,
    parse_scale_ratio_from_text,
)

logger = logging.getLogger(__name__)

INFERENCE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OCR_VENV_PYTHON = INFERENCE_ROOT / (
    ".venv-ocr/Scripts/python.exe" if os.name == "nt" else ".venv-ocr/bin/python"
)
DEFAULT_TF_VENV_PYTHON = INFERENCE_ROOT / (
    ".venv-tf/Scripts/python.exe" if os.name == "nt" else ".venv-tf/bin/python"
)

LEVEL_RE = re.compile(
    r"(?i)\b(?:level|lvl|floor|storey|story)\s*[-.:#]?\s*([A-Z0-9]+|\d+[A-Z]?)\b"
    r"|\b(?:L|LVL|FL|FLR)\s*[-.:#]?\s*(\d+[A-Z]?)\b"
    r"|\b(ground\s+floor|ground\s+level|basement(?:\s+\d+)?|mezzanine(?:\s+floor|\s+level)?|podium(?:\s+level)?|roof(?:\s+plan|\s+level)?)\b",
)
ORDINAL_FLOOR_RE = re.compile(
    r"(?i)\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|"
    r"eleventh|twelfth|1st|2nd|3rd|[4-9]th|\d+(?:st|nd|rd|th))\s+floor\b",
)
ORDINAL_LABEL = {
    "first": "First Floor",
    "1st": "First Floor",
    "second": "Second Floor",
    "2nd": "Second Floor",
    "third": "Third Floor",
    "3rd": "Third Floor",
    "fourth": "Fourth Floor",
    "4th": "Fourth Floor",
    "fifth": "Fifth Floor",
    "5th": "Fifth Floor",
    "sixth": "Sixth Floor",
    "6th": "Sixth Floor",
    "seventh": "Seventh Floor",
    "7th": "Seventh Floor",
    "eighth": "Eighth Floor",
    "8th": "Eighth Floor",
    "ninth": "Ninth Floor",
    "9th": "Ninth Floor",
    "tenth": "Tenth Floor",
    "10th": "Tenth Floor",
    "eleventh": "Eleventh Floor",
    "11th": "Eleventh Floor",
    "twelfth": "Twelfth Floor",
    "12th": "Twelfth Floor",
}
UNIT_RE = re.compile(
    r"(?i)\b(?:unit|apt|apartment|dwelling|tenancy|flat|suite)\s*[#.:-]?\s*([A-Z0-9]{1,8})\b",
)
UNIT_ID_STOPWORDS = {
    "PLAN",
    "TYPE",
    "MIX",
    "SCHEDULE",
    "KEY",
    "AREA",
    "LAYOUT",
    "NUMBER",
    "NO",
    "NOS",
    "ID",
    "IDS",
    "INDEX",
    "LIST",
    "TABLE",
}
TITLE_CUES = ("floor plan", "unit plan", "general arrangement", "ga plan", "rcp", "reflected ceiling")
ROOM_LABEL_RE = re.compile(
    r"(?i)\b(bed(?:room)?|bath(?:room)?|kitchen|living|wc|ensuite|robe|pantry|garage|study|laundry)\b",
)


def clamp01(value: float) -> float:
    return float(max(0.0, min(1.0, value)))


def crop_rgb_normalized(rgb: np.ndarray, crop: dict[str, float]) -> tuple[np.ndarray, dict[str, float]]:
    """Crop ``rgb`` using normalized fractions {x, y, width, height}. Returns crop and pixel bounds."""
    height, width = rgb.shape[:2]
    x0 = int(clamp01(float(crop.get("x", 0))) * width)
    y0 = int(clamp01(float(crop.get("y", 0))) * height)
    x1 = int(clamp01(float(crop.get("x", 0)) + float(crop.get("width", 1))) * width)
    y1 = int(clamp01(float(crop.get("y", 0)) + float(crop.get("height", 1))) * height)
    x0 = max(0, min(width - 1, x0))
    y0 = max(0, min(height - 1, y0))
    x1 = max(x0 + 1, min(width, x1))
    y1 = max(y0 + 1, min(height, y1))
    bounds = {"x0": x0, "y0": y0, "x1": x1, "y1": y1, "width": x1 - x0, "height": y1 - y0}
    return rgb[y0:y1, x0:x1], bounds


def remap_ocr_lines_to_page(
    lines: list[dict[str, Any]],
    *,
    crop_bounds: dict[str, float | int],
    page_width: int,
    page_height: int,
) -> list[dict[str, Any]]:
    """Shift OCR line boxes from a crop back into full-page pixel coordinates."""
    ox = float(crop_bounds["x0"])
    oy = float(crop_bounds["y0"])
    out: list[dict[str, Any]] = []
    for row in lines:
        bbox = row.get("bbox")
        remapped = None
        if isinstance(bbox, list) and bbox:
            remapped = [[float(x) + ox, float(y) + oy] for x, y in bbox]
        out.append({**row, "bbox": remapped})
    return out


def sheet_meta_from_crop(
    meta: dict[str, Any],
    *,
    crop_bounds: dict[str, float | int],
    page_width: int,
    page_height: int,
) -> dict[str, Any]:
    lines = meta.get("lines") or []
    if not isinstance(lines, list) or not lines:
        return meta
    return {
        **meta,
        "lines": remap_ocr_lines_to_page(
            lines,
            crop_bounds=crop_bounds,
            page_width=page_width,
            page_height=page_height,
        ),
    }


def resolve_paddle_python(settings: Settings | None = None) -> Path | None:
    settings = settings or get_settings()
    configured = (getattr(settings, "paddle_ocr_python", None) or "").strip()
    tf_py = (settings.tensorflow_python or "").strip()
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured))
    candidates.append(DEFAULT_OCR_VENV_PYTHON)
    if tf_py:
        candidates.append(Path(tf_py))
    candidates.append(DEFAULT_TF_VENV_PYTHON)
    for path in candidates:
        if path.is_file():
            return path.resolve()
    return None


_probe_paddle_ok: dict[str, bool] = {}
_probe_paddle_vl_ok: dict[str, bool] = {}


def resolve_ocr_backend(
    settings: Settings | None = None,
    ocr_options: dict[str, Any] | None = None,
) -> str:
    raw = ""
    if ocr_options:
        raw = str(ocr_options.get("backend") or "").strip()
    if not raw:
        settings = settings or get_settings()
        raw = str(getattr(settings, "paddle_ocr_backend", None) or "classic").strip()
    key = raw.lower().replace("_", "-")
    if key in {"vl", "paddleocr-vl", "vlm"}:
        return "vl"
    return "classic"


def _probe_paddle(python_exe: str) -> bool:
    if _probe_paddle_ok.get(python_exe):
        return True
    try:
        proc = subprocess.run(
            [python_exe, "-c", "from paddleocr import PaddleOCR; print('ok')"],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(INFERENCE_ROOT),
            env={**os.environ, "FLAGS_use_mkldnn": "0"},
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    ok = proc.returncode == 0 and "ok" in (proc.stdout or "")
    if ok:
        _probe_paddle_ok[python_exe] = True
    return ok


def _probe_paddle_vl(python_exe: str) -> bool:
    if _probe_paddle_vl_ok.get(python_exe):
        return True
    try:
        proc = subprocess.run(
            [python_exe, "-c", "from paddleocr import PaddleOCRVL; print('ok')"],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(INFERENCE_ROOT),
            env={**os.environ, "FLAGS_use_mkldnn": "0"},
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    ok = proc.returncode == 0 and "ok" in (proc.stdout or "")
    if ok:
        _probe_paddle_vl_ok[python_exe] = True
    return ok


def paddle_ocr_vl_available(settings: Settings | None = None) -> bool:
    try:
        from paddleocr import PaddleOCRVL  # noqa: F401

        return True
    except ImportError:
        pass
    py = resolve_paddle_python(settings)
    if py is None:
        return False
    return _probe_paddle_vl(str(py))


def paddle_ocr_available(
    settings: Settings | None = None,
    backend: str | None = None,
) -> bool:
    settings = settings or get_settings()
    chosen = resolve_ocr_backend(settings, {"backend": backend} if backend else None)
    if chosen == "vl":
        return paddle_ocr_vl_available(settings)
    try:
        from paddleocr import PaddleOCR  # noqa: F401

        return True
    except ImportError:
        pass
    py = resolve_paddle_python(settings)
    if py is None:
        return False
    return _probe_paddle(str(py))


def paddle_ocr_hint(
    settings: Settings | None = None,
    backend: str | None = None,
) -> str:
    settings = settings or get_settings()
    chosen = resolve_ocr_backend(settings, {"backend": backend} if backend else None)
    py = resolve_paddle_python(settings)
    if chosen == "vl":
        if py is not None and _probe_paddle_vl(str(py)):
            return f"PaddleOCR-VL ready via {py}"
        if py is not None:
            return (
                f"Found {py} but PaddleOCR-VL is missing. Install with: "
                f"{py} -m pip install -r requirements-paddle-vl.txt "
                "(needs paddleocr[doc-parser]>=3.4). Then set PADDLE_OCR_BACKEND=vl."
            )
        return (
            "Create a Python 3.10–3.12 venv and install PaddleOCR-VL: "
            "pip install -r requirements-paddle-vl.txt "
            "(or set PADDLE_OCR_PYTHON). See https://huggingface.co/PaddlePaddle/PaddleOCR-VL"
        )
    if py is not None and _probe_paddle(str(py)):
        return f"PaddleOCR ready via {py}"
    if py is not None:
        return (
            f"Found {py} but PaddleOCR is missing. Install with: "
            f"{py} -m pip install -r requirements-paddle.txt"
        )
    return (
        "Create services/inference/.venv-ocr with Python 3.10–3.12, then: "
        "pip install -r requirements-paddle.txt "
        "(or set PADDLE_OCR_PYTHON to that interpreter)."
    )


def _env_for_worker() -> dict[str, str]:
    return {
        **os.environ,
        "PYTHONPATH": str(INFERENCE_ROOT)
        + (os.pathsep + os.environ["PYTHONPATH"] if os.environ.get("PYTHONPATH") else ""),
        "FLAGS_use_mkldnn": "0",
        "PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK": "True",
        "PYTHONUNBUFFERED": "1",
    }


_OCR_WORKER_LOCK = threading.Lock()
_ocr_worker: subprocess.Popen[str] | None = None
_ocr_worker_py: str | None = None


def _kill_ocr_worker() -> None:
    global _ocr_worker, _ocr_worker_py
    proc = _ocr_worker
    _ocr_worker = None
    _ocr_worker_py = None
    if proc is None:
        return
    try:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)
    except Exception:
        pass


atexit.register(_kill_ocr_worker)


def _get_ocr_worker(python_exe: str) -> subprocess.Popen[str]:
    global _ocr_worker, _ocr_worker_py
    if _ocr_worker is not None and _ocr_worker.poll() is None and _ocr_worker_py == python_exe:
        return _ocr_worker
    _kill_ocr_worker()
    proc = subprocess.Popen(
        [python_exe, "-m", "app.pipeline.paddle_ocr_worker"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(INFERENCE_ROOT),
        env=_env_for_worker(),
        bufsize=1,
    )
    _ocr_worker = proc
    _ocr_worker_py = python_exe
    return proc


def _run_ocr_worker_job(
    python_exe: str,
    payload: dict[str, Any],
    *,
    timeout_s: float,
    on_progress: Any | None = None,
) -> dict[str, Any]:
    """Send one JSON job to the persistent OCR process and wait for done/error."""
    with _OCR_WORKER_LOCK:
        proc = _get_ocr_worker(python_exe)
        assert proc.stdin is not None and proc.stdout is not None
        body = json.dumps(payload) + "\n"
        try:
            proc.stdin.write(body)
            proc.stdin.flush()
        except (BrokenPipeError, OSError):
            _kill_ocr_worker()
            proc = _get_ocr_worker(python_exe)
            assert proc.stdin is not None and proc.stdout is not None
            proc.stdin.write(body)
            proc.stdin.flush()

        timed_out = threading.Event()

        def _on_timeout() -> None:
            timed_out.set()
            _kill_ocr_worker()

        timer = threading.Timer(timeout_s, _on_timeout)
        timer.daemon = True
        timer.start()
        done: dict[str, Any] | None = None
        errors: list[str] = []
        logs: list[str] = []
        try:
            while True:
                line = proc.stdout.readline()
                if line == "":
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    logs.append(line)
                    continue
                kind = str(event.get("type") or "")
                if kind == "status":
                    if on_progress is not None:
                        on_progress("status", {"message": str(event.get("message") or "")})
                    continue
                if kind == "done":
                    done = event
                    break
                if kind == "error":
                    errors.append(str(event.get("message") or "OCR failed"))
                    break
        finally:
            timer.cancel()

        if timed_out.is_set():
            raise TimeoutError(
                f"PaddleOCR worker timed out after {int(timeout_s)}s. "
                "PaddleOCR-VL first load on CPU can take several minutes; retry once, or enable GPU."
            )
        if errors:
            raise RuntimeError(f"PaddleOCR worker failed: {errors[0]}")
        if done is None:
            code = proc.poll()
            detail = "\n".join(logs[-15:]) or f"worker exited ({code})"
            _kill_ocr_worker()
            raise RuntimeError(f"PaddleOCR worker finished without results.\n{detail}")
        return done


def _ocr_det_params(settings: Settings, profile: str, ocr_options: dict[str, Any] | None = None) -> dict[str, Any]:
    """Detection kwargs for PaddleOCR — ``dense`` keeps more pixels for small plan labels."""
    opts = ocr_options or {}
    det_side = opts.get("det_limit_side_len")
    det_db = opts.get("det_db_thresh")
    if profile == "dense":
        return {
            "det_limit_side_len": int(det_side) if det_side is not None else int(settings.paddle_ocr_dense_det_limit_side_len),
            "det_db_thresh": float(det_db) if det_db is not None else float(settings.paddle_ocr_dense_db_thresh),
        }
    return {
        "det_limit_side_len": int(det_side) if det_side is not None else int(settings.paddle_ocr_det_limit_side_len),
        "det_db_thresh": float(det_db) if det_db is not None else None,
    }


def _ocr_tile_size(settings: Settings, profile: str, ocr_options: dict[str, Any] | None = None) -> int:
    """Tile window = PaddleOCR default 960 (or the GUI det_limit), same idea as YOLO imgsz."""
    opts = ocr_options or {}
    if opts.get("det_limit_side_len") is not None:
        size = int(opts["det_limit_side_len"])
    else:
        size = int(settings.paddle_ocr_tile_size or settings.paddle_ocr_det_limit_side_len or 960)
    return max(320, size)


def upsample_rgb_for_ocr(rgb: np.ndarray, min_side: int) -> tuple[np.ndarray, float]:
    """Enlarge small crops so Paddle sees them at its 960px default (it will not upscale itself)."""
    if rgb.ndim < 2 or min_side <= 0:
        return rgb, 1.0
    height, width = int(rgb.shape[0]), int(rgb.shape[1])
    longest = max(height, width)
    if longest <= 0 or longest >= min_side:
        return rgb, 1.0
    scale = min_side / float(longest)
    new_w = max(1, int(round(width * scale)))
    new_h = max(1, int(round(height * scale)))
    resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.BICUBIC)
    out = np.asarray(Image.fromarray(rgb).resize((new_w, new_h), resample), dtype=np.uint8)
    return out, scale


def scale_ocr_line_boxes(lines: list[dict[str, Any]], scale: float) -> list[dict[str, Any]]:
    """Map OCR boxes from an upsampled raster back to the original crop."""
    if not lines or abs(scale - 1.0) < 1e-6:
        return lines
    inv = 1.0 / scale
    out: list[dict[str, Any]] = []
    for row in lines:
        bbox = row.get("bbox")
        if not isinstance(bbox, list) or not bbox:
            out.append(row)
            continue
        try:
            shifted = [[float(p[0]) * inv, float(p[1]) * inv] for p in bbox]
        except (TypeError, ValueError, IndexError):
            out.append(row)
            continue
        out.append({**row, "bbox": shifted})
    return out


def run_paddle_ocr_lines(
    rgb: np.ndarray,
    *,
    settings: Settings | None = None,
    profile: str = "default",
    ocr_options: dict[str, Any] | None = None,
    on_progress: Any | None = None,
) -> list[dict[str, Any]]:
    """
    Return OCR lines: {text, confidence, bbox:[[x,y],...]}.
    Prefers in-process PaddleOCR; else subprocess via .venv-ocr.
    """
    settings = settings or get_settings()
    opts = ocr_options or {}
    backend = resolve_ocr_backend(settings, opts)
    det = _ocr_det_params(settings, profile, opts)
    pipeline_version = str(
        opts.get("pipeline_version") or settings.paddle_ocr_vl_pipeline_version or "v1"
    )
    vl_max_side = int(opts.get("vl_max_side") or settings.paddle_ocr_vl_max_side or 2048)
    vl_rec_model_dir = str(
        opts.get("vl_rec_model_dir") or settings.paddle_ocr_vl_rec_model_dir or ""
    ).strip() or None
    layout_detection_model_dir = str(
        opts.get("layout_detection_model_dir") or settings.paddle_ocr_vl_layout_model_dir or ""
    ).strip() or None

    if backend == "vl":
        from app.pipeline.paddle_ocr_vl import _maybe_downscale

        rgb_in, up_scale = _maybe_downscale(rgb, vl_max_side)
        inner_vl_max = 0
    else:
        rgb_in, up_scale = upsample_rgb_for_ocr(rgb, int(det["det_limit_side_len"] or 960))
        inner_vl_max = vl_max_side

    lang = str(opts.get("lang") or settings.paddle_ocr_lang or "en")
    use_gpu = bool(opts.get("use_gpu") if "use_gpu" in opts else settings.paddle_ocr_use_gpu)
    use_doc_orientation_classify = bool(opts.get("use_doc_orientation_classify", True))
    use_doc_unwarping = bool(opts.get("use_doc_unwarping", False))
    use_textline_orientation = bool(opts.get("use_textline_orientation", True))
    text_rec_score_thresh = float(opts.get("text_rec_score_thresh", 0.5))
    use_layout_detection = bool(opts.get("use_layout_detection", False))
    # Title-block crops are already a single region. Layout / orientation extra
    # models are the wrong prior and, with use_queues, can hang forever on Windows.
    if backend == "vl" and max(int(rgb_in.shape[0]), int(rgb_in.shape[1])) < 1600:
        use_layout_detection = False
        use_doc_orientation_classify = False
        use_doc_unwarping = False

    in_process_ok = False
    if backend == "vl":
        try:
            from paddleocr import PaddleOCRVL  # noqa: F401

            in_process_ok = True
        except ImportError:
            in_process_ok = False
    else:
        try:
            from paddleocr import PaddleOCR  # noqa: F401

            in_process_ok = True
        except ImportError:
            in_process_ok = False

    if in_process_ok:
        from app.pipeline.paddle_ocr_worker import ocr_image_array

        return scale_ocr_line_boxes(
            ocr_image_array(
                rgb_in,
                lang=lang,
                use_gpu=use_gpu,
                det_limit_side_len=det["det_limit_side_len"],
                det_db_thresh=det["det_db_thresh"],
                use_doc_orientation_classify=use_doc_orientation_classify,
                use_doc_unwarping=use_doc_unwarping,
                use_textline_orientation=use_textline_orientation,
                text_rec_score_thresh=text_rec_score_thresh,
                backend=backend,
                pipeline_version=pipeline_version,
                vl_max_side=inner_vl_max,
                use_layout_detection=use_layout_detection,
                vl_rec_model_dir=vl_rec_model_dir,
                layout_detection_model_dir=layout_detection_model_dir,
            ),
            up_scale,
        )

    py = resolve_paddle_python(settings)
    ready = _probe_paddle_vl(str(py)) if backend == "vl" and py else (_probe_paddle(str(py)) if py else False)
    if py is None or not ready:
        raise RuntimeError(paddle_ocr_hint(settings, backend=backend))

    with tempfile.TemporaryDirectory(prefix="hl-ocr-") as tmp:
        img_path = Path(tmp) / "page.png"
        Image.fromarray(rgb_in).save(img_path, format="PNG")
        payload = {
            "image_path": str(img_path),
            "lang": lang,
            "use_gpu": use_gpu,
            "det_limit_side_len": det["det_limit_side_len"],
            "det_db_thresh": det["det_db_thresh"],
            "use_doc_orientation_classify": use_doc_orientation_classify,
            "use_doc_unwarping": use_doc_unwarping,
            "use_textline_orientation": use_textline_orientation,
            "text_rec_score_thresh": text_rec_score_thresh,
            "backend": backend,
            "pipeline_version": pipeline_version,
            "vl_max_side": inner_vl_max,
            "use_layout_detection": use_layout_detection,
            "vl_rec_model_dir": vl_rec_model_dir,
            "layout_detection_model_dir": layout_detection_model_dir,
        }
        timeout_s = 600.0 if backend == "vl" else 180.0
        done = _run_ocr_worker_job(str(py), payload, timeout_s=timeout_s, on_progress=on_progress)
        return scale_ocr_line_boxes(list(done.get("lines") or []), up_scale)


def run_paddle_ocr_lines_for_crop(
    rgb: np.ndarray,
    *,
    settings: Settings | None = None,
    profile: str = "default",
    ocr_options: dict[str, Any] | None = None,
    on_progress: Any | None = None,
    cancel_check: Any | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    OCR a crop. Pages larger than Paddle's 960px default are tiled (same pattern as YOLO infer).
    Crops smaller than 960 are upsampled so small title-block / label text is readable.
    """
    settings = settings or get_settings()
    backend = resolve_ocr_backend(settings, ocr_options)

    def _run(crop_rgb: np.ndarray) -> list[dict[str, Any]]:
        return run_paddle_ocr_lines(
            crop_rgb,
            settings=settings,
            profile=profile,
            ocr_options=ocr_options,
            on_progress=on_progress,
        )

    # PaddleOCR-VL is a page/crop VLM — tiling 960px windows through a 0.9B model is slow
    # and NaViT already handles variable resolution. Skip classic PP-OCR tiling.
    if backend != "vl" and bool(settings.paddle_ocr_tile_enabled):
        from app.pipeline.paddle_ocr_tiling import run_tiled_ocr_lines

        size = _ocr_tile_size(settings, profile, ocr_options)
        tile_opts = {**(ocr_options or {}), "det_limit_side_len": size}

        def _run_tile(crop_rgb: np.ndarray) -> list[dict[str, Any]]:
            return run_paddle_ocr_lines(
                crop_rgb,
                settings=settings,
                profile=profile,
                ocr_options=tile_opts,
                on_progress=on_progress,
            )

        return run_tiled_ocr_lines(
            rgb,
            run_ocr=_run_tile,
            settings=settings,
            tile_size=size,
            min_side=size,
            on_progress=on_progress,
            cancel_check=cancel_check,
        )

    height, width = int(rgb.shape[0]), int(rgb.shape[1])
    full_tile = {"x": 0, "y": 0, "width": width, "height": height}
    meta = {"tiled": False, "tileCount": 1, "tileSize": int(settings.paddle_ocr_tile_size), "width": width, "height": height}
    if on_progress is not None:
        on_progress("meta", meta)
        on_progress("tile_start", {"index": 1, "total": 1, "tile": full_tile})
    lines = _run(rgb)
    if on_progress is not None:
        on_progress("tile_done", {"index": 1, "total": 1, "tile": full_tile, "lineCount": len(lines)})
    return lines, meta


def _join_text(lines: list[dict[str, Any]]) -> str:
    return "\n".join(str(x.get("text") or "") for x in lines if x.get("text"))


def _with_plan_suffix(label: str, source: str) -> str:
    if re.search(r"(?i)\bplan\b", label):
        return label
    if re.search(r"(?i)\b(?:floor|level|storey|story)\s+plan\b", source):
        return f"{label} Plan"
    return label


def parse_level_name(text: str) -> str | None:
    if not text:
        return None
    ordinal = ORDINAL_FLOOR_RE.search(text)
    if ordinal:
        token = ordinal.group(1).lower()
        label: str | None = None
        if token in ORDINAL_LABEL:
            label = ORDINAL_LABEL[token]
        elif token.isdigit() or re.match(r"^\d+", token):
            num = int(re.match(r"^\d+", token).group(0))  # type: ignore[union-attr]
            if num > 0:
                label = f"Level {num}"
        if label:
            return _with_plan_suffix(label, text)
    m = LEVEL_RE.search(text)
    if not m:
        return None
    if m.group(3):
        phrase = re.sub(r"\s+", " ", m.group(3).strip().title())
        return _with_plan_suffix(phrase, text)
    token = (m.group(1) or m.group(2) or "").strip().upper()
    if not token:
        return None
    if token.isdigit() or re.match(r"^\d+[A-Z]?$", token):
        return _with_plan_suffix(f"Level {token}", text)
    if token.lower() in {"g", "gf"}:
        return _with_plan_suffix("Ground Floor", text)
    return _with_plan_suffix(f"Level {token}", text)


def parse_unit_ids(text: str, *, limit: int = 20) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for m in UNIT_RE.finditer(text or ""):
        uid = m.group(1).strip().upper()
        if not uid or uid in seen or uid in UNIT_ID_STOPWORDS:
            continue
        if not re.search(r"\d", uid) and len(uid) > 3:
            continue
        seen.add(uid)
        found.append(uid)
        if len(found) >= limit:
            break
    return found


def infer_sheet_type(text: str) -> str:
    t = (text or "").lower()
    if any(k in t for k in ("rcp", "reflected ceiling")):
        return "rcp"
    if any(k in t for k in ("unit plan", "apartment", "dwelling")):
        return "unit"
    if any(k in t for k in ("floor plan", "general arrangement", "ga plan", "ground floor", "level ")):
        return "ga"
    return "unknown"


def pick_paper_from_lines(lines: list[dict[str, Any]]) -> str | None:
    for row in lines:
        paper = parse_paper_from_text(str(row.get("text") or ""))
        if paper:
            return paper
    return None


def _ocr_line_box(bbox: Any) -> tuple[float, float, float, float, float, float, float, float] | None:
    """Return (x0, y0, x1, y1, cx, cy, w, h) from an OCR polygon."""
    if not isinstance(bbox, list) or len(bbox) < 2:
        return None
    xs: list[float] = []
    ys: list[float] = []
    for pt in bbox:
        try:
            xs.append(float(pt[0]))
            ys.append(float(pt[1]))
        except (TypeError, ValueError, IndexError):
            continue
    if len(xs) < 2:
        return None
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    w = max(1.0, x1 - x0)
    h = max(1.0, y1 - y0)
    return x0, y0, x1, y1, (x0 + x1) / 2.0, (y0 + y1) / 2.0, w, h


def _tokens_spatially_nearby(a: tuple[float, ...], b: tuple[float, ...]) -> bool:
    ax0, ay0, ax1, ay1, _acx, _acy, _aw, ah = a
    bx0, by0, bx1, by1, _bcx, _bcy, _bw, bh = b
    h = max(ah, bh, 10.0)
    gap_x = max(0.0, ax0 - bx1, bx0 - ax1)
    gap_y = max(0.0, ay0 - by1, by0 - ay1)
    return gap_x <= h * 12 and gap_y <= h * 5


def _scale_tokens_nearby(
    a_box: tuple[float, ...] | None,
    a_index: int,
    b_box: tuple[float, ...] | None,
    b_index: int,
) -> bool:
    if a_box is not None and b_box is not None:
        return _tokens_spatially_nearby(a_box, b_box)
    return abs(a_index - b_index) <= 2


def pick_scale_from_lines(lines: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    """Prefer ``1:N @ AX``. Cluster SCALE / ratio / paper by bbox position, not list order."""
    # 1. Single line check for combined 1:N @ AX
    for row in lines:
        raw = str(row.get("text") or "").strip()
        if not raw:
            continue
        parsed = parse_scale_and_paper(raw)
        if parsed:
            return format_scale_declaration(parsed[0], parsed[1]), parsed[1]

    labels: list[tuple[int, tuple[float, ...] | None]] = []
    ratios: list[tuple[int, int, float, bool, tuple[float, ...] | None]] = []
    papers: list[tuple[str, int, float, tuple[float, ...] | None]] = []

    for idx, row in enumerate(lines):
        raw = str(row.get("text") or "").strip()
        if not raw:
            continue
        conf = float(row.get("confidence") or 0)
        box = _ocr_line_box(row.get("bbox"))
        has_kw = "scale" in raw.lower()
        if has_kw:
            labels.append((idx, box))
        ratio = parse_scale_ratio_from_text(raw)
        if ratio:
            ratios.append((ratio, idx, conf, has_kw, box))
        paper = parse_paper_from_text(raw)
        if paper:
            papers.append((paper, idx, conf, box))

    def near_scale_label(index: int, box: tuple[float, ...] | None) -> bool:
        return any(_scale_tokens_nearby(box, index, lbl_box, lbl_idx) for lbl_idx, lbl_box in labels)

    best_pair: tuple[float, int, str] | None = None
    for r_scale, r_idx, r_conf, has_kw, r_box in ratios:
        for p_code, p_idx, p_conf, p_box in papers:
            if not _scale_tokens_nearby(r_box, r_idx, p_box, p_idx):
                continue
            labeled = has_kw or near_scale_label(r_idx, r_box) or near_scale_label(p_idx, p_box)
            score = (20.0 if labeled else 8.0) + (r_conf + p_conf)
            if r_box is not None and p_box is not None:
                score -= ((r_box[4] - p_box[4]) ** 2 + (r_box[5] - p_box[5]) ** 2) ** 0.5 / 40.0
            else:
                score -= abs(r_idx - p_idx)
            if best_pair is None or score > best_pair[0]:
                best_pair = (score, r_scale, p_code)

    if best_pair is not None:
        return format_scale_declaration(best_pair[1], best_pair[2]), best_pair[2]

    if ratios:
        labeled = [r for r in ratios if r[3] or near_scale_label(r[1], r[4])]
        pool = labeled or ratios
        pool.sort(key=lambda x: (1 if x[3] else 0, x[2]), reverse=True)
        return format_scale_declaration(pool[0][0]), None

    return None, None


def pick_level_from_lines(lines: list[dict[str, Any]]) -> str | None:
    best: tuple[float, str] | None = None
    for row in lines:
        text = str(row.get("text") or "").strip()
        if not text:
            continue
        level = parse_level_name(text)
        if not level:
            continue
        conf = float(row.get("confidence") or 0)
        score = conf
        low = text.lower()
        if any(k in low for k in ("floor plan", "level", "floor", "storey", "story", "ground")):
            score += 0.4
        if best is None or score > best[0]:
            best = (score, level)
    if best:
        return best[1]
    return parse_level_name(_join_text(lines))


def pick_title(lines: list[dict[str, Any]]) -> str | None:
    """Prefer a longer high-confidence line that looks like a drawing title."""
    best: tuple[float, str] | None = None
    for row in lines:
        text = str(row.get("text") or "").strip()
        if len(text) < 6:
            continue
        if parse_scale_and_paper(text) or parse_scale_ratio_from_text(text):
            continue
        if ROOM_LABEL_RE.search(text):
            continue
        conf = float(row.get("confidence") or 0)
        score = conf
        low = text.lower()
        if any(c in low for c in TITLE_CUES):
            score += 0.35
        if "scale" in low:
            score -= 0.2
        if best is None or score > best[0]:
            best = (score, text)
    return best[1] if best else None


def sheet_meta_from_ocr_lines(
    lines: list[dict[str, Any]],
    *,
    max_lines: int = 200,
) -> dict[str, Any]:
    scale_text, paper = pick_scale_from_lines(lines)
    level_name = pick_level_from_lines(lines)
    units = parse_unit_ids(_join_text(lines))
    title = pick_title(lines)
    meta_lines = [
        row
        for row in lines
        if row.get("text")
        and (
            parse_level_name(str(row["text"]))
            or parse_scale_and_paper(str(row["text"]))
            or parse_scale_ratio_from_text(str(row["text"]))
            or any(c in str(row["text"]).lower() for c in TITLE_CUES)
        )
    ]
    text = _join_text(meta_lines or lines)
    confs = [float(x.get("confidence") or 0) for x in lines if x.get("text")]
    mean_conf = sum(confs) / len(confs) if confs else 0.0

    return {
        "sheetType": infer_sheet_type(text),
        "title": title,
        "scaleText": scale_text,
        "paperSize": paper,
        "north": None,
        "levelName": level_name,
        "unitIds": units,
        "warnings": [],
        "provider": "paddleocr",
        "confidence": round(min(0.95, max(0.4, mean_conf)), 3),
        "ocrLineCount": len(lines),
        "textHint": text[:4000],
        "lines": [
            {
                "text": str(x.get("text") or ""),
                "confidence": float(x.get("confidence") or 0),
                "bbox": x.get("bbox"),
            }
            for x in lines[:max_lines]
        ],
    }


def ocr_pdf_pages(
    pdf_bytes: bytes,
    *,
    dpi: float = 300.0,
    page_numbers: list[int] | None = None,
    page_crops: dict[int, dict[str, float]] | None = None,
    settings: Settings | None = None,
    ocr_options: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Rasterize PDF pages at ``dpi`` and run PaddleOCR on each page.

    ``page_crops`` maps 1-based page numbers to normalized crop boxes
    ``{x, y, width, height}`` (fractions of the rasterized page). When set,
    OCR runs on the crop only — used for title-block scale extraction.
    """
    if not pdf_bytes:
        raise ValueError("Empty PDF bytes.")
    dpi = max(72.0, float(dpi))
    settings = settings or get_settings()
    from app.studio.link_path import _pdf_page_count, render_pdf_page_png, render_pdf_page_region_png

    pages_out: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="hl-ocr-pdf-") as tmp:
        pdf_path = Path(tmp) / "source.pdf"
        pdf_path.write_bytes(pdf_bytes)
        total = _pdf_page_count(pdf_path)
        wanted = sorted({int(n) for n in (page_numbers or []) if int(n) > 0})
        if not wanted:
            wanted = list(range(1, total + 1))
        for page_num in wanted:
            if page_num < 1 or page_num > total:
                continue
            crop = (page_crops or {}).get(page_num)
            crop_bounds: dict[str, float | int] | None = None
            if crop:
                png, crop_w, crop_h = render_pdf_page_region_png(
                    pdf_path, page_num, crop, dpi=dpi
                )
                width, height = crop_w, crop_h
            else:
                png, width, height = render_pdf_page_png(pdf_path, page_num, dpi=dpi)
            pixels = int(width) * int(height)
            prev_limit = Image.MAX_IMAGE_PIXELS
            try:
                # OCR rasters are trusted local PDF renders; allow above PIL's default bomb guard.
                if pixels > (prev_limit or 0):
                    Image.MAX_IMAGE_PIXELS = pixels + 1
                rgb = np.array(Image.open(BytesIO(png)).convert("RGB"))
            finally:
                Image.MAX_IMAGE_PIXELS = prev_limit
            ocr_rgb = rgb
            if crop:
                crop_bounds = {"x0": 0, "y0": 0, "x1": width, "y1": height, "width": width, "height": height}
            meta = extract_sheet_context_paddle(ocr_rgb, settings=settings, ocr_options=ocr_options)
            page_out: dict[str, Any] = {
                "pageNumber": page_num,
                "widthPx": int(width),
                "heightPx": int(height),
                "sheet": meta,
                "cropped": bool(crop),
            }
            if crop_bounds is not None:
                page_out["cropWidthPx"] = int(crop_bounds["width"])
                page_out["cropHeightPx"] = int(crop_bounds["height"])
            pages_out.append(page_out)
    return pages_out


def extract_sheet_context_paddle(
    rgb: np.ndarray,
    *,
    settings: Settings | None = None,
    profile: str = "default",
    ocr_options: dict[str, Any] | None = None,
    on_progress: Any | None = None,
    cancel_check: Any | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    lines, tiling = run_paddle_ocr_lines_for_crop(
        rgb,
        settings=settings,
        profile=profile,
        ocr_options=ocr_options,
        on_progress=on_progress,
        cancel_check=cancel_check,
    )
    max_lines = int(settings.paddle_ocr_max_lines) if profile == "dense" else 200
    if not lines:
        out = {
            "sheetType": "unknown",
            "title": None,
            "scaleText": None,
            "north": None,
            "levelName": None,
            "unitIds": [],
            "warnings": ["PaddleOCR returned no text lines"],
            "provider": "paddleocr-vl" if resolve_ocr_backend(settings, ocr_options) == "vl" else "paddleocr",
            "confidence": 0.2,
            "ocrLineCount": 0,
            "textHint": "",
            "lines": [],
        }
        if tiling.get("tiled"):
            out["tiling"] = tiling
        return out
    meta = sheet_meta_from_ocr_lines(lines, max_lines=max_lines)
    meta["provider"] = "paddleocr-vl" if resolve_ocr_backend(settings, ocr_options) == "vl" else "paddleocr"
    if tiling.get("tiled"):
        meta["tiling"] = tiling
    return meta
