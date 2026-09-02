"""Sheet-level global context via heuristic OCR-ish cues or optional VLM HTTP API."""

from __future__ import annotations

import json
import re
from typing import Any

import numpy as np
from PIL import Image

from app.config import Settings, get_settings


SCALE_RE = re.compile(
    r"(?:scale\s*[:=]?\s*)?(1\s*:\s*\d{1,4}|1/\d{1,4})",
    re.IGNORECASE,
)
SHEET_CUES = {
    "rcp": ("rcp", "reflected ceiling", "ceiling plan"),
    "unit": ("unit plan", "apartment", "dwelling"),
    "ga": ("general arrangement", "ga plan", "floor plan", "ground floor", "level "),
}


def _downscale_rgb(rgb: np.ndarray, max_side: int = 1280) -> np.ndarray:
    h, w = rgb.shape[:2]
    m = max(h, w)
    if m <= max_side:
        return rgb
    scale = max_side / float(m)
    img = Image.fromarray(rgb)
    out = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.BILINEAR)
    return np.asarray(out)


def heuristic_sheet_meta(rgb: np.ndarray) -> dict[str, Any]:
    """
    Lightweight heuristic context without an external model.

    Uses corner crops + simple ink density / placeholder fields. Real OCR can
    replace the text_hint later; structure stays the same for VLM merge.
    """
    h, w = rgb.shape[:2]
    # Sample title-block-ish bottom-right and top strip.
    br = rgb[int(h * 0.75) :, int(w * 0.55) :]
    top = rgb[: max(1, int(h * 0.12)), :]
    ink_br = float(np.mean(br < 200)) if br.size else 0.0
    ink_top = float(np.mean(top < 200)) if top.size else 0.0
    sheet_type = "unknown"
    if ink_br > 0.08:
        sheet_type = "ga"
    return {
        "sheetType": sheet_type,
        "title": None,
        "scaleText": None,
        "north": None,
        "warnings": [],
        "provider": "heuristic",
        "inkDensityTitleBlock": round(ink_br, 4),
        "inkDensityHeader": round(ink_top, 4),
        "confidence": 0.35,
    }


def _call_vlm_http(rgb: np.ndarray, settings: Settings) -> dict[str, Any]:
    import base64
    from io import BytesIO

    import httpx

    img = Image.fromarray(_downscale_rgb(rgb))
    buf = BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    headers = {"Content-Type": "application/json"}
    if settings.vlm_api_key:
        headers["Authorization"] = f"Bearer {settings.vlm_api_key}"
    prompt = (
        "You analyse architectural floor-plan sheets. "
        "Return JSON only with keys: sheetType (ga|unit|rcp|unknown), "
        "title (string|null), scaleText (string|null), north (string|null), "
        "warnings (string[])."
    )
    payload = {
        "model": settings.vlm_model or "gpt-4o-mini",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{b64}"},
                    },
                ],
            }
        ],
        "response_format": {"type": "json_object"},
    }
    url = settings.vlm_api_url.strip() or "https://api.openai.com/v1/chat/completions"
    with httpx.Client(timeout=60.0) as client:
        res = client.post(url, headers=headers, json=payload)
    res.raise_for_status()
    body = res.json()
    content = body["choices"][0]["message"]["content"]
    data = json.loads(content) if isinstance(content, str) else content
    data["provider"] = "vlm_http"
    data["confidence"] = 0.7
    return data


def extract_sheet_context(
    rgb: np.ndarray,
    *,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Return sheet-level metadata for scene-graph meta merge."""
    settings = settings or get_settings()
    provider = (settings.vlm_provider or "heuristic").strip().lower()

    # Explicit OCR even when VLM_ENABLED is false if provider is paddleocr and enabled via flag.
    use_paddle = provider in {"paddle", "paddleocr", "ocr"} and (
        settings.vlm_enabled or settings.paddle_ocr_enabled
    )
    if use_paddle:
        try:
            from app.pipeline.paddle_ocr import extract_sheet_context_paddle

            return extract_sheet_context_paddle(rgb, settings=settings)
        except Exception as exc:
            meta = heuristic_sheet_meta(rgb)
            meta["warnings"] = [f"PaddleOCR failed: {exc}"]
            meta["provider"] = "heuristic_fallback"
            return meta

    if not settings.vlm_enabled:
        return heuristic_sheet_meta(rgb)

    if (
        settings.vlm_allow_remote_images
        and provider in {"http", "openai", "vlm"}
        and (settings.vlm_api_url or settings.vlm_api_key)
    ):
        try:
            return _call_vlm_http(rgb, settings)
        except Exception as exc:
            meta = heuristic_sheet_meta(rgb)
            meta["warnings"] = [f"VLM failed: {exc}"]
            meta["provider"] = "heuristic_fallback"
            return meta
    return heuristic_sheet_meta(rgb)
