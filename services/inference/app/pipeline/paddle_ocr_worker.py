"""PaddleOCR worker — stdin JSON job, stdout NDJSON events.

Runs under services/inference/.venv-tf (Python 3.10–3.12).
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any

import numpy as np
from PIL import Image


def _emit(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _result_to_dict(obj: Any) -> dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    json_fn = getattr(obj, "json", None)
    if callable(json_fn):
        try:
            data = json_fn()
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    try:
        return dict(obj)
    except Exception:
        return {}


def _poly_to_quad(poly: Any) -> list[list[float]] | None:
    if poly is None:
        return None
    try:
        arr = np.asarray(poly, dtype=float)
    except Exception:
        return None
    if arr.size >= 8:
        return [[float(x), float(y)] for x, y in arr.reshape(-1, 2)[:4]]
    if arr.size >= 4:
        x0, y0, x1, y1 = [float(v) for v in arr.reshape(-1)[:4]]
        return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    return None


def classic_predict_kwargs(
    *,
    det_limit_side_len: int,
    det_db_thresh: float | None,
    use_doc_orientation_classify: bool,
    use_doc_unwarping: bool,
    use_textline_orientation: bool,
    text_rec_score_thresh: float,
) -> list[dict[str, Any]]:
    """PaddleOCR 3.x reads these on predict(), not only the constructor."""
    full: dict[str, Any] = {
        "use_doc_orientation_classify": bool(use_doc_orientation_classify),
        "use_doc_unwarping": bool(use_doc_unwarping),
        "use_textline_orientation": bool(use_textline_orientation),
        "text_det_limit_side_len": int(det_limit_side_len),
        "text_det_limit_type": "max",
        "text_rec_score_thresh": float(text_rec_score_thresh),
        "use_queues": False,
    }
    if det_db_thresh is not None:
        full["text_det_thresh"] = float(det_db_thresh)
    return [
        full,
        {
            "use_doc_orientation_classify": bool(use_doc_orientation_classify),
            "use_doc_unwarping": bool(use_doc_unwarping),
            "use_textline_orientation": bool(use_textline_orientation),
        },
        {},
    ]


def _normalize_result(raw: Any, min_score: float = 0.0) -> list[dict[str, Any]]:
    """Support PaddleOCR 2.x list layout and 3.x dict/result objects with score filtering."""
    lines: list[dict[str, Any]] = []
    if raw is None:
        return lines

    pages = raw if isinstance(raw, list) else [raw]
    dict_pages = [_result_to_dict(page) for page in pages]
    if dict_pages and any("rec_texts" in page or "dt_polys" in page for page in dict_pages):
        for page in dict_pages:
            texts = page.get("rec_texts") or []
            scores = page.get("rec_scores") or []
            polys = page.get("rec_polys") or page.get("dt_polys") or page.get("rec_boxes") or []
            for i, text in enumerate(texts):
                conf = float(scores[i]) if i < len(scores) else 0.0
                if conf < min_score:
                    continue
                bbox = _poly_to_quad(polys[i]) if i < len(polys) else None
                if str(text).strip():
                    lines.append({"text": str(text).strip(), "confidence": conf, "bbox": bbox})
        return lines

    # Classic PaddleOCR.ocr(): [[ [box, (text, conf)], ... ]]
    for page in pages:
        if not page:
            continue
        try:
            items = list(page)
        except TypeError:
            continue
        for item in items:
            try:
                box, rec = item[0], item[1]
                text = str(rec[0]).strip()
                conf = float(rec[1])
                if conf < min_score:
                    continue
                bbox = _poly_to_quad(box)
            except Exception:
                continue
            if text:
                lines.append({"text": text, "confidence": conf, "bbox": bbox})
    return lines


_OCR_CACHE: dict[str, Any] = {}


def _cache_key(
    *,
    lang: str,
    use_gpu: bool,
    det_limit_side_len: int,
    det_db_thresh: float | None,
    use_doc_orientation_classify: bool,
    use_doc_unwarping: bool,
    use_textline_orientation: bool,
    text_rec_score_thresh: float,
) -> str:
    return (
        f"{lang}|{int(use_gpu)}|{det_limit_side_len}|{det_db_thresh}|"
        f"{int(use_doc_orientation_classify)}|{int(use_doc_unwarping)}|"
        f"{int(use_textline_orientation)}|{text_rec_score_thresh}"
    )


def _get_ocr(
    *,
    lang: str = "en",
    use_gpu: bool = False,
    det_limit_side_len: int = 960,
    det_db_thresh: float | None = None,
    use_doc_orientation_classify: bool = False,
    use_doc_unwarping: bool = False,
    use_textline_orientation: bool = True,
    text_rec_score_thresh: float = 0.5,
):
    key = _cache_key(
        lang=lang,
        use_gpu=use_gpu,
        det_limit_side_len=det_limit_side_len,
        det_db_thresh=det_db_thresh,
        use_doc_orientation_classify=use_doc_orientation_classify,
        use_doc_unwarping=use_doc_unwarping,
        use_textline_orientation=use_textline_orientation,
        text_rec_score_thresh=text_rec_score_thresh,
    )
    cached = _OCR_CACHE.get(key)
    if cached is not None:
        return cached

    from paddleocr import PaddleOCR

    angle_cls = bool(use_textline_orientation or use_doc_orientation_classify)
    v3: dict[str, Any] = {
        "lang": lang or "en",
        "use_doc_orientation_classify": use_doc_orientation_classify,
        "use_doc_unwarping": use_doc_unwarping,
        "use_textline_orientation": use_textline_orientation,
        "text_det_limit_side_len": int(det_limit_side_len),
        "text_det_limit_type": "max",
        "text_rec_score_thresh": float(text_rec_score_thresh),
        "use_queues": False,
    }
    if det_db_thresh is not None:
        v3["text_det_thresh"] = float(det_db_thresh)

    # Try fullest parameter combinations first
    attempts = [
        v3,
        {**v3, "use_gpu": use_gpu},
        # Modern PP-OCR 2.x names
        {
            "lang": lang or "en",
            "use_gpu": use_gpu,
            "use_doc_orientation_classify": use_doc_orientation_classify,
            "use_doc_unwarping": use_doc_unwarping,
            "use_textline_orientation": use_textline_orientation,
            "text_rec_score_thresh": float(text_rec_score_thresh),
            "show_log": False,
            "det_limit_side_len": int(det_limit_side_len),
            "det_limit_type": "max",
        },
        # Standard PaddleOCR 2.x/3.x with use_angle_cls and drop_score
        {
            "lang": lang or "en",
            "use_gpu": use_gpu,
            "use_angle_cls": angle_cls,
            "drop_score": float(text_rec_score_thresh),
            "show_log": False,
            "det_limit_side_len": int(det_limit_side_len),
            "det_limit_type": "max",
        },
        # Minimal angle_cls
        {
            "lang": lang or "en",
            "use_gpu": use_gpu,
            "use_angle_cls": angle_cls,
            "show_log": False,
            "det_limit_side_len": int(det_limit_side_len),
        },
        # Bare kwargs
        {
            "lang": lang or "en",
            "use_angle_cls": angle_cls,
            "det_limit_side_len": int(det_limit_side_len),
        },
        {"lang": lang or "en"},
    ]

    for kw in attempts:
        try:
            ocr = PaddleOCR(**kw)
            _OCR_CACHE[key] = ocr
            return ocr
        except TypeError:
            continue
        except Exception:
            break

    # Fallback to default constructor
    ocr = PaddleOCR(lang=lang or "en")
    _OCR_CACHE[key] = ocr
    return ocr


def ocr_image_array(
    rgb: np.ndarray,
    *,
    lang: str = "en",
    use_gpu: bool = False,
    det_limit_side_len: int = 960,
    det_db_thresh: float | None = None,
    use_doc_orientation_classify: bool = False,
    use_doc_unwarping: bool = False,
    use_textline_orientation: bool = True,
    text_rec_score_thresh: float = 0.5,
    backend: str = "classic",
    pipeline_version: str = "v1",
    vl_max_side: int = 2048,
    use_layout_detection: bool = False,
    vl_rec_model_dir: str | None = None,
    layout_detection_model_dir: str | None = None,
) -> list[dict[str, Any]]:
    if str(backend).strip().lower() in {"vl", "paddleocr-vl", "paddleocr_vl", "vlm"}:
        from app.pipeline.paddle_ocr_vl import run_paddleocr_vl_array

        return run_paddleocr_vl_array(
            rgb,
            pipeline_version=pipeline_version or "v1",
            use_gpu=use_gpu,
            max_side=int(vl_max_side) if vl_max_side is not None else 2048,
            use_layout_detection=use_layout_detection,
            use_doc_orientation_classify=use_doc_orientation_classify,
            use_doc_unwarping=use_doc_unwarping,
            vl_rec_model_dir=vl_rec_model_dir,
            layout_detection_model_dir=layout_detection_model_dir,
        )

    ocr = _get_ocr(
        lang=lang,
        use_gpu=use_gpu,
        det_limit_side_len=det_limit_side_len,
        det_db_thresh=det_db_thresh,
        use_doc_orientation_classify=use_doc_orientation_classify,
        use_doc_unwarping=use_doc_unwarping,
        use_textline_orientation=use_textline_orientation,
        text_rec_score_thresh=text_rec_score_thresh,
    )
    raw = None
    if hasattr(ocr, "predict"):
        for kw in classic_predict_kwargs(
            det_limit_side_len=det_limit_side_len,
            det_db_thresh=det_db_thresh,
            use_doc_orientation_classify=use_doc_orientation_classify,
            use_doc_unwarping=use_doc_unwarping,
            use_textline_orientation=use_textline_orientation,
            text_rec_score_thresh=text_rec_score_thresh,
        ):
            try:
                raw = ocr.predict(rgb, **kw)
                break
            except TypeError:
                continue
            except Exception:
                raw = None
                break
    if raw is None and hasattr(ocr, "ocr"):
        bgr = rgb[:, :, ::-1].copy()
        try:
            raw = ocr.ocr(bgr, cls=bool(use_textline_orientation or use_doc_orientation_classify))
        except TypeError:
            raw = ocr.ocr(bgr)
    return _normalize_result(raw, min_score=0.0)


def _handle_job(job: dict[str, Any]) -> None:
    image_path = str(job.get("image_path") or "").strip()
    if not image_path:
        raise ValueError("image_path is required")
    lang = str(job.get("lang") or "en")
    use_gpu = bool(job.get("use_gpu"))
    det_limit_side_len = int(job.get("det_limit_side_len") or 960)
    det_db_thresh = job.get("det_db_thresh")
    det_db_thresh_f = float(det_db_thresh) if det_db_thresh is not None else None
    use_doc_orientation_classify = bool(job.get("use_doc_orientation_classify", False))
    use_doc_unwarping = bool(job.get("use_doc_unwarping", False))
    use_textline_orientation = bool(job.get("use_textline_orientation", True))
    text_rec_score_thresh = float(job.get("text_rec_score_thresh", 0.5))
    backend = str(job.get("backend") or "classic")
    pipeline_version = str(job.get("pipeline_version") or "v1")
    vl_max_side = int(job.get("vl_max_side") or 2048)
    use_layout_detection = bool(job.get("use_layout_detection", False))
    vl_rec_model_dir = job.get("vl_rec_model_dir") or None
    layout_detection_model_dir = job.get("layout_detection_model_dir") or None

    if str(backend).strip().lower() in {"vl", "paddleocr-vl", "paddleocr_vl", "vlm"}:
        _emit({
            "type": "status",
            "message": "Loading PaddleOCR-VL (first run can take several minutes on CPU)…",
        })

    rgb = np.asarray(Image.open(image_path).convert("RGB"), dtype=np.uint8)
    lines = ocr_image_array(
        rgb,
        lang=lang,
        use_gpu=use_gpu,
        det_limit_side_len=det_limit_side_len,
        det_db_thresh=det_db_thresh_f,
        use_doc_orientation_classify=use_doc_orientation_classify,
        use_doc_unwarping=use_doc_unwarping,
        use_textline_orientation=use_textline_orientation,
        text_rec_score_thresh=text_rec_score_thresh,
        backend=backend,
        pipeline_version=pipeline_version,
        vl_max_side=vl_max_side,
        use_layout_detection=use_layout_detection,
        vl_rec_model_dir=vl_rec_model_dir,
        layout_detection_model_dir=layout_detection_model_dir,
    )
    _emit({"type": "done", "lines": lines, "count": len(lines)})


def main() -> int:
    """Stay alive across jobs so PaddleOCR-VL is not reloaded every title-block click."""
    while True:
        try:
            raw = sys.stdin.readline()
        except KeyboardInterrupt:
            return 130
        if not raw:
            return 0
        raw = raw.strip()
        if not raw:
            continue
        try:
            job = json.loads(raw.lstrip("\ufeff"))
            if str(job.get("cmd") or "") == "shutdown":
                return 0
            _handle_job(job)
        except KeyboardInterrupt:
            _emit(
                {
                    "type": "error",
                    "message": (
                        "OCR interrupted before results were ready. "
                        "If the inference server reloaded or you pressed Ctrl+C, run OCR again. "
                        "Avoid uvicorn --reload while OCR is running."
                    ),
                    "cancelled": True,
                }
            )
            return 130
        except Exception as exc:
            _emit({"type": "error", "message": str(exc), "trace": traceback.format_exc()})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
