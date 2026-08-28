"""PaddleOCR-VL backend — Hugging Face PaddlePaddle/PaddleOCR-VL (0.9B VLM).

Classic PP-OCR (det+rec CNN) cannot load this checkpoint as rec_model_dir.
PaddleOCR-VL is a separate document-parsing pipeline (`PaddleOCRVL`) that we
normalize into the same `{text, confidence, bbox}` lines used by the viewer.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

INFERENCE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_VL_REC_DIR = INFERENCE_ROOT / "models" / "paddleocr-vl"
DEFAULT_VL_LAYOUT_DIR = INFERENCE_ROOT / "models" / "paddleocr-vl-layout"
HF_VL_REPO_ID = "PaddlePaddle/PaddleOCR-VL"

_WEIGHT_MARKERS = (
    "config.json",
    "configuration.json",
    "inference.yml",
    "inference.json",
    "model.safetensors",
    "model.pdparams",
    "pytorch_model.bin",
)

# paddleocr 3.7 defaults to pipeline v1.6 (PP-DocLayoutV3 / PaddleOCR-VL-1.6-0.9B).
# The Hugging Face PaddleOCR-VL snapshot is the original 0.9B + PP-DocLayoutV2 (v1).
_LAYOUT_TO_PIPELINE = {
    "PP-DocLayoutV2": "v1",
    "PP-DocLayoutV3": "v1.6",
}
_PIPELINE_TO_REC_NAME = {
    "v1": "PaddleOCR-VL-0.9B",
    "v1.5": "PaddleOCR-VL-0.9B",
    "v1.6": "PaddleOCR-VL-1.6-0.9B",
}
_PIPELINE_TO_LAYOUT_NAME = {
    "v1": "PP-DocLayoutV2",
    "v1.5": "PP-DocLayoutV2",
    "v1.6": "PP-DocLayoutV3",
}
_VALID_PIPELINE_VERSIONS = {"v1", "v1.5", "v1.6"}


def _as_dict(obj: Any) -> dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    for attr in ("json", "res", "data"):
        val = getattr(obj, attr, None)
        if isinstance(val, dict):
            return val
        if callable(val):
            try:
                got = val()
            except Exception:
                continue
            if isinstance(got, dict):
                return got
    if hasattr(obj, "items"):
        try:
            return dict(obj)
        except Exception:
            return {}
    return {}


def _to_quad(raw: Any) -> list[list[float]] | None:
    """Normalize VL bboxes to a 4-point polygon [[x,y], ...]."""
    if raw is None:
        return None
    if isinstance(raw, dict):
        if "points" in raw:
            return _to_quad(raw.get("points"))
        x = raw.get("x")
        y = raw.get("y")
        w = raw.get("width") or raw.get("w")
        h = raw.get("height") or raw.get("h")
        if None not in (x, y, w, h):
            x0, y0 = float(x), float(y)
            x1, y1 = x0 + float(w), y0 + float(h)
            return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
        return None

    if not isinstance(raw, (list, tuple)):
        return None
    if not raw:
        return None

    # Already a polygon: [[x,y], ...]
    if isinstance(raw[0], (list, tuple)):
        pts: list[list[float]] = []
        for p in raw:
            if not isinstance(p, (list, tuple)) or len(p) < 2:
                continue
            pts.append([float(p[0]), float(p[1])])
        if len(pts) >= 4:
            return pts[:4]
        if len(pts) == 2:
            (x0, y0), (x1, y1) = pts
            return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
        return None

    nums = [float(v) for v in raw]
    if len(nums) >= 8:
        return [[nums[0], nums[1]], [nums[2], nums[3]], [nums[4], nums[5]], [nums[6], nums[7]]]
    if len(nums) >= 4:
        x0, y0, x1, y1 = nums[0], nums[1], nums[2], nums[3]
        return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    return None


def _lines_from_ocr_res(ocr_res: Any) -> list[dict[str, Any]]:
    data = _as_dict(ocr_res)
    texts = data.get("rec_texts") or data.get("rec_text") or []
    scores = data.get("rec_scores") or data.get("rec_score") or []
    polys = data.get("rec_polys") or data.get("dt_polys") or data.get("rec_boxes") or []
    lines: list[dict[str, Any]] = []
    for i, text in enumerate(texts):
        t = str(text or "").strip()
        if not t:
            continue
        conf = float(scores[i]) if i < len(scores) else 0.9
        bbox = _to_quad(polys[i]) if i < len(polys) else None
        lines.append({"text": t, "confidence": conf, "bbox": bbox})
    return lines


def _lines_from_parsing_list(blocks: Any) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    if not isinstance(blocks, list):
        return lines
    skip_labels = {"figure", "image", "chart", "seal", "header", "footer", "number"}
    for block in blocks:
        data = _as_dict(block)
        label = str(data.get("block_label") or data.get("label") or "text").lower()
        if label in skip_labels:
            continue
        text = str(
            data.get("block_content")
            or data.get("content")
            or data.get("text")
            or ""
        ).strip()
        if not text:
            continue
        bbox = _to_quad(
            data.get("block_bbox")
            or data.get("bbox")
            or data.get("poly")
            or data.get("points")
        )
        conf = float(data.get("score") or data.get("confidence") or 0.9)
        for part in text.splitlines():
            part = part.strip()
            if part:
                lines.append({"text": part, "confidence": conf, "bbox": bbox})
    return lines


def normalize_vl_result(raw: Any) -> list[dict[str, Any]]:
    """Convert PaddleOCRVL.predict() output to viewer OCR lines."""
    if raw is None:
        return []
    pages = raw if isinstance(raw, list) else [raw]
    lines: list[dict[str, Any]] = []
    for page in pages:
        data = _as_dict(page)
        from_ocr = _lines_from_ocr_res(data.get("ocr_res") or data)
        if from_ocr:
            lines.extend(from_ocr)
            continue
        parsed = _lines_from_parsing_list(data.get("parsing_res_list") or data.get("parsing_res"))
        if parsed:
            lines.extend(parsed)
            continue
        # Last-resort: already-normalized list of dicts with text
        if isinstance(page, dict) and "text" in page:
            t = str(page.get("text") or "").strip()
            if t:
                lines.append(
                    {
                        "text": t,
                        "confidence": float(page.get("confidence") or 0.9),
                        "bbox": _to_quad(page.get("bbox")),
                    }
                )
    return lines


def looks_like_vl_weights(path: Path) -> bool:
    if not path.is_dir():
        return False
    names = {p.name.lower() for p in path.iterdir()}
    if any(marker in names for marker in _WEIGHT_MARKERS):
        return True
    for child in path.iterdir():
        if not child.is_dir():
            continue
        child_names = {p.name.lower() for p in child.iterdir()}
        if any(marker in child_names for marker in _WEIGHT_MARKERS):
            return True
    return False


def resolve_vl_model_dir(configured: str | None = None, *, default: Path = DEFAULT_VL_REC_DIR) -> str | None:
    candidates: list[Path] = []
    if configured and str(configured).strip():
        candidates.append(Path(str(configured).strip()))
    candidates.append(default)
    for path in candidates:
        resolved = path.expanduser()
        if not resolved.is_absolute():
            resolved = (INFERENCE_ROOT / resolved).resolve()
        else:
            resolved = resolved.resolve()
        if looks_like_vl_weights(resolved):
            return str(resolved)
    return None


def read_paddlex_model_name(path: Path | str | None) -> str | None:
    """Read Global.model_name from a PaddleX inference.yml (or the folder name)."""
    if not path:
        return None
    folder = Path(path)
    if not folder.is_dir():
        return None
    for name in ("inference.yml", "inference.yaml"):
        yml = folder / name
        if not yml.is_file():
            continue
        text = yml.read_text(encoding="utf-8", errors="ignore")
        match = re.search(r"(?m)^\s*model_name:\s*['\"]?([A-Za-z0-9._-]+)", text)
        if match:
            return match.group(1)
    if folder.name.startswith("PP-DocLayout"):
        return folder.name
    return None


def align_pipeline_version(requested: str | None, layout_model_name: str | None) -> str:
    """Pick a pipeline version whose default layout model matches local weights."""
    req = str(requested or "v1").strip()
    if req not in _VALID_PIPELINE_VERSIONS:
        req = "v1"
    if not layout_model_name:
        return req
    compatible = _LAYOUT_TO_PIPELINE.get(layout_model_name)
    if compatible is None:
        return req
    if layout_model_name == "PP-DocLayoutV2" and req in {"v1.5", "v1.6"}:
        return "v1"
    if layout_model_name == "PP-DocLayoutV3" and req == "v1":
        return compatible
    return req


def rec_compatible_with_pipeline(rec_name: str | None, version: str) -> bool:
    """True when a local VL rec checkpoint can be passed as vl_rec_model_dir."""
    if not rec_name:
        return False
    name = rec_name.strip()
    if version == "v1.6":
        return "1.6" in name
    if version == "v1.5":
        return "1.5" in name
    return name == "PaddleOCR-VL-0.9B" and "1.5" not in name and "1.6" not in name


def layout_compatible_with_pipeline(layout_name: str | None, version: str) -> bool:
    if not layout_name:
        return False
    expected = _PIPELINE_TO_LAYOUT_NAME.get(version)
    return bool(expected) and layout_name == expected


_VL_CACHE: dict[str, Any] = {}


def _drop_unexpected_kwarg(exc: TypeError, kwargs: dict[str, Any]) -> dict[str, Any] | None:
    match = re.search(r"unexpected keyword argument ['\"](\w+)['\"]", str(exc))
    if not match:
        return None
    key = match.group(1)
    if key not in kwargs:
        return None
    next_kw = dict(kwargs)
    del next_kw[key]
    return next_kw


def _get_vl_pipeline(
    *,
    pipeline_version: str = "v1",
    use_gpu: bool = False,
    use_layout_detection: bool = True,
    use_doc_orientation_classify: bool = False,
    use_doc_unwarping: bool = False,
    vl_rec_model_dir: str | None = None,
    layout_detection_model_dir: str | None = None,
):
    rec_dir = resolve_vl_model_dir(vl_rec_model_dir, default=DEFAULT_VL_REC_DIR)
    layout_dir = (
        resolve_vl_model_dir(layout_detection_model_dir, default=DEFAULT_VL_LAYOUT_DIR)
        if use_layout_detection
        else None
    )
    rec_name = read_paddlex_model_name(rec_dir) if rec_dir else None
    layout_name = read_paddlex_model_name(layout_dir) if layout_dir else None
    version = align_pipeline_version(pipeline_version, layout_name if use_layout_detection else None)
    if rec_dir and not rec_compatible_with_pipeline(rec_name, version):
        rec_dir = None
        rec_name = None
    if layout_dir and not layout_compatible_with_pipeline(layout_name, version):
        layout_dir = None
        layout_name = None
    key = (
        f"{version}|{int(use_gpu)}|{int(use_layout_detection)}|"
        f"{int(use_doc_orientation_classify)}|{int(use_doc_unwarping)}|"
        f"{rec_dir or ''}|{layout_dir or ''}|{layout_name or ''}|{rec_name or ''}"
    )
    cached = _VL_CACHE.get(key)
    if cached is not None:
        return cached

    from paddleocr import PaddleOCRVL

    base: dict[str, Any] = {
        "pipeline_version": version,
        "use_layout_detection": bool(use_layout_detection),
        "use_doc_orientation_classify": bool(use_doc_orientation_classify),
        "use_doc_unwarping": bool(use_doc_unwarping),
        "use_chart_recognition": False,
        "use_seal_recognition": False,
        "use_ocr_for_image_block": False,
        "use_queues": False,
        "device": "gpu" if use_gpu else "cpu",
    }
    rec_model_name = _PIPELINE_TO_REC_NAME.get(version)
    if rec_model_name:
        base["vl_rec_model_name"] = rec_model_name
    if rec_dir:
        base["vl_rec_model_dir"] = rec_dir
    if layout_dir:
        base["layout_detection_model_dir"] = layout_dir
        if layout_name:
            base["layout_detection_model_name"] = layout_name
    elif use_layout_detection:
        layout_model_name = _PIPELINE_TO_LAYOUT_NAME.get(version)
        if layout_model_name:
            base["layout_detection_model_name"] = layout_model_name

    kw = dict(base)
    last_err: Exception | None = None
    seen: set[tuple[tuple[str, Any], ...]] = set()
    while True:
        frozen = tuple(sorted(kw.items()))
        if frozen in seen:
            break
        seen.add(frozen)
        try:
            pipeline = PaddleOCRVL(**kw)
            _VL_CACHE[key] = pipeline
            return pipeline
        except TypeError as exc:
            last_err = exc
            nxt = _drop_unexpected_kwarg(exc, kw)
            if nxt is not None:
                kw = nxt
                continue
            break
        except ValueError as exc:
            last_err = exc
            msg = str(exc)
            if "Model name mismatch" not in msg:
                raise
            stripped = {
                k: v
                for k, v in kw.items()
                if k
                not in {
                    "vl_rec_model_dir",
                    "layout_detection_model_dir",
                }
            }
            if stripped == kw:
                raise
            kw = stripped
            continue
    if last_err:
        raise last_err
    raise RuntimeError("Could not construct PaddleOCRVL.")


def _maybe_downscale(rgb: np.ndarray, max_side: int) -> tuple[np.ndarray, float]:
    if rgb.ndim < 2 or max_side <= 0:
        return rgb, 1.0
    height, width = int(rgb.shape[0]), int(rgb.shape[1])
    longest = max(height, width)
    if longest <= max_side:
        return rgb, 1.0
    scale = max_side / float(longest)
    new_w = max(1, int(round(width * scale)))
    new_h = max(1, int(round(height * scale)))
    resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.BICUBIC)
    out = np.asarray(Image.fromarray(rgb).resize((new_w, new_h), resample), dtype=np.uint8)
    return out, scale


def _scale_boxes(lines: list[dict[str, Any]], scale: float) -> list[dict[str, Any]]:
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


def run_paddleocr_vl_array(
    rgb: np.ndarray,
    *,
    pipeline_version: str = "v1",
    use_gpu: bool = False,
    max_side: int = 2048,
    use_layout_detection: bool = True,
    use_doc_orientation_classify: bool = False,
    use_doc_unwarping: bool = False,
    vl_rec_model_dir: str | None = None,
    layout_detection_model_dir: str | None = None,
) -> list[dict[str, Any]]:
    rgb_in, scale = _maybe_downscale(rgb, max_side)
    pipeline = _get_vl_pipeline(
        pipeline_version=pipeline_version,
        use_gpu=use_gpu,
        use_layout_detection=use_layout_detection,
        use_doc_orientation_classify=use_doc_orientation_classify,
        use_doc_unwarping=use_doc_unwarping,
        vl_rec_model_dir=vl_rec_model_dir,
        layout_detection_model_dir=layout_detection_model_dir,
    )
    predict_attempts: list[dict[str, Any]] = [
        {
            "use_layout_detection": bool(use_layout_detection),
            "use_doc_orientation_classify": bool(use_doc_orientation_classify),
            "use_doc_unwarping": bool(use_doc_unwarping),
            "use_chart_recognition": False,
            "use_seal_recognition": False,
            "use_queues": False,
            "prompt_label": "ocr",
        },
        {
            "use_layout_detection": bool(use_layout_detection),
            "use_doc_orientation_classify": bool(use_doc_orientation_classify),
            "use_doc_unwarping": bool(use_doc_unwarping),
            "use_queues": False,
        },
        {"use_queues": False},
    ]
    raw = None
    last_err: Exception | None = None
    for predict_kw in predict_attempts:
        try:
            raw = pipeline.predict(rgb_in, **predict_kw)
            last_err = None
            break
        except TypeError as exc:
            last_err = exc
            continue
    if raw is None:
        if last_err:
            raise last_err
        raise RuntimeError("PaddleOCRVL.predict returned no result.")
    return _scale_boxes(normalize_vl_result(raw), scale)
