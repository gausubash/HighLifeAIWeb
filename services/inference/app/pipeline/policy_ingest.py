"""Turn uploaded policy text / YAML / JSON into a HighLife policy pack."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx
import yaml

logger = logging.getLogger(__name__)


LLM_SYSTEM = """You extract every design guideline from a residential policy document.
Keep the document's own grouping (headings / clause numbers). Do not invent clauses or numbers.
Include qualitative and quantitative requirements (shall / must / should / required / minimum).
Lines may be prefixed like [p3 L12] — copy those ids into lineIds when they match the excerpt.
Pages may include photographed or scanned tables. Read every table: each row or numeric threshold is its own guideline.
When a requirement is only visible in a page image, set page and rects as 0–1 fractions of that page:
[{"page": 4, "x": 0.1, "y": 0.2, "width": 0.8, "height": 0.06}].
Only set mappedKind when the guideline is clearly one of the HighLife checks listed below; otherwise null.
Return JSON only:
{
  "version": "string",
  "name": "string",
  "jurisdiction": "string",
  "description": "string",
  "notes": ["string"],
  "groups": [
    {
      "title": "document heading",
      "guidelines": [
        {
          "name": "short title",
          "text": "full requirement in the document's words",
          "clause": "4.2.1",
          "sourceText": "verbatim excerpt",
          "lineIds": ["p4L12"],
          "page": 4,
          "mappedKind": "apartment_min_internal|apartment_min_living|apartment_min_pos|apartment_min_bedroom|apartment_min_bathrooms|apartment_min_storage|apartment_dual_aspect|habitable_has_window|communal_open_space|room_min_area|required_labels|null",
          "requiresScale": true,
          "minAreaM2": 9,
          "byBedrooms": {"0": 35, "1": 50, "2": 70, "3": 90},
          "minCount": 1,
          "m2PerDwelling": 2.5,
          "requiredLabels": ["Bedroom"]
        }
      ]
    }
  ]
}
"""

TEXT_LIMIT = 48000
VISION_PAGES_PER_REQUEST = 3
MAX_VISION_IMAGE_CHARS = 2_800_000
MAPPED_KINDS = {
    "apartment_min_internal",
    "apartment_min_living",
    "apartment_min_pos",
    "apartment_min_bedroom",
    "apartment_min_bathrooms",
    "apartment_min_storage",
    "apartment_dual_aspect",
    "habitable_has_window",
    "communal_open_space",
    "room_min_area",
    "required_labels",
    "min_wall_count",
}


def pack_from_yaml_or_json(text: str, file_name: str | None = None) -> dict[str, Any]:
    raw = text.strip()
    if not raw:
        raise ValueError("Empty policy text.")
    if raw[0] in "{[":
        data = json.loads(raw)
    else:
        data = yaml.safe_load(raw)
    if not isinstance(data, dict):
        raise ValueError("Policy must be a JSON/YAML object.")
    rules = data.get("rules") if isinstance(data.get("rules"), list) else []
    guidelines = data.get("guidelines") if isinstance(data.get("guidelines"), list) else []
    groups = data.get("groups") if isinstance(data.get("groups"), list) else []
    if not rules and not guidelines and not groups:
        raise ValueError("Policy has no guidelines or rules.")
    version = str(data.get("version") or data.get("id") or (file_name or "uploaded").rsplit(".", 1)[0])
    return {
        "id": str(data.get("id") or version),
        "version": version,
        "name": str(data.get("name") or file_name or "Uploaded policy"),
        "jurisdiction": data.get("jurisdiction"),
        "description": data.get("description"),
        "source": {"kind": "yaml" if raw[0] not in "{[" else "json", "fileName": file_name},
        "notes": data.get("notes") or [],
        "rules": rules,
        "guidelines": guidelines,
        "groups": groups,
    }


def _num(text: str | None) -> float | None:
    if not text:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)", text.replace(",", ""))
    return float(m.group(1)) if m else None


def heuristic_from_text(text: str, file_name: str | None = None) -> dict[str, Any]:
    blob = re.sub(r"\s+", " ", text)
    rules: list[dict[str, Any]] = []
    notes: list[str] = []

    studio = re.search(r"studio[^.]{0,80}?(\d+(?:\.\d+)?)\s*m", blob, re.I)
    one = re.search(r"1[-\s]?bed(?:room)?[^.]{0,80}?(\d+(?:\.\d+)?)\s*m", blob, re.I)
    two = re.search(r"2[-\s]?bed(?:room)?[^.]{0,80}?(\d+(?:\.\d+)?)\s*m", blob, re.I)
    three = re.search(r"3[-\s]?bed(?:room)?[^.]{0,80}?(\d+(?:\.\d+)?)\s*m", blob, re.I)
    if studio or one or two or three:
        rules.append(
            {
                "code": "RDS-APT-SIZE",
                "name": "Minimum internal apartment area",
                "kind": "apartment_min_internal",
                "requiresScale": True,
                "byBedrooms": {
                    "0": _num(studio.group(1) if studio else None) or 35,
                    "1": _num(one.group(1) if one else None) or 50,
                    "2": _num(two.group(1) if two else None) or 70,
                    "3": _num(three.group(1) if three else None) or 90,
                },
                "sourceText": (studio or one or two or three).group(0)[:180],
            }
        )

    bed = re.search(r"bedroom[^.]{0,60}?(\d+(?:\.\d+)?)\s*(?:m²|m2|sqm)", blob, re.I)
    if bed:
        rules.append(
            {
                "code": "RDS-BED-MIN",
                "name": "Minimum bedroom area",
                "kind": "apartment_min_bedroom",
                "requiresScale": True,
                "minAreaM2": _num(bed.group(1)) or 9,
                "sourceText": bed.group(0)[:180],
            }
        )

    if re.search(r"dual aspect|windows on two sides|natural ventilation", blob, re.I):
        rules.append(
            {
                "code": "RDS-ASPECT-DUAL",
                "name": "Natural ventilation / dual aspect",
                "kind": "apartment_dual_aspect",
                "sourceText": "dual aspect / natural ventilation",
            }
        )

    if not rules:
        notes.append("No numeric apartment rules were recognised from the text.")

    stem = (file_name or "uploaded-policy").rsplit(".", 1)[0]
    return {
        "id": f"pdf:{stem}",
        "version": re.sub(r"\s+", "_", stem).lower(),
        "name": stem,
        "description": "Converted from uploaded policy text.",
        "source": {"kind": "pdf", "fileName": file_name},
        "notes": notes,
        "rules": rules,
    }


def is_gemini_generate_url(url: str) -> bool:
    lower = (url or "").lower()
    return "generativelanguage.googleapis.com" in lower and "generatecontent" in lower


def gemini_url_with_key(url: str, api_key: str) -> str:
    if not api_key or "key=" in url:
        return url
    return f"{url}{'&' if '?' in url else '?'}key={api_key}"


def gemini_generate_payload(text: str, file_name: str | None) -> dict[str, Any]:
    return {
        "systemInstruction": {"parts": [{"text": LLM_SYSTEM}]},
        "contents": [
            {
                "role": "user",
                "parts": [{"text": f"File: {file_name or 'policy'}\n\n{text[:TEXT_LIMIT]}"}],
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
        },
    }


def openai_chat_payload(text: str, file_name: str | None, model: str) -> dict[str, Any]:
    return {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": LLM_SYSTEM},
            {
                "role": "user",
                "content": f"File: {file_name or 'policy'}\n\n{text[:TEXT_LIMIT]}",
            },
        ],
    }


def decode_policy_page_image(raw: str) -> tuple[str, str] | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    value = raw.strip()
    mime = "image/jpeg"
    b64 = value
    if value.startswith("data:"):
        header, _, rest = value.partition(",")
        if not rest:
            return None
        if "image/png" in header:
            mime = "image/png"
        elif "image/webp" in header:
            mime = "image/webp"
        b64 = rest
    if len(b64) > MAX_VISION_IMAGE_CHARS:
        return None
    return mime, b64


def normalize_policy_pages(pages: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in pages or []:
        if not isinstance(item, dict):
            continue
        page_number = item.get("pageNumber") or item.get("page")
        decoded = decode_policy_page_image(str(item.get("image") or item.get("dataUrl") or ""))
        if page_number is None or not decoded:
            continue
        mime, b64 = decoded
        out.append({"pageNumber": int(page_number), "mime": mime, "b64": b64})
    return out


def gemini_vision_payload(text: str, file_name: str | None, pages: list[dict[str, Any]]) -> dict[str, Any]:
    parts: list[dict[str, Any]] = [
        {
            "text": (
                f"File: {file_name or 'policy'}\n"
                "These images are pages of a public design-policy PDF (not a floor plan). "
                "Read tables in the images as well as the selectable text.\n\n"
                f"{text[:TEXT_LIMIT]}"
            )
        }
    ]
    for page in pages:
        parts.append({"text": f"Page {page['pageNumber']} image:"})
        parts.append({"inlineData": {"mimeType": page["mime"], "data": page["b64"]}})
    return {
        "systemInstruction": {"parts": [{"text": LLM_SYSTEM}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
    }


def openai_vision_payload(
    text: str,
    file_name: str | None,
    model: str,
    pages: list[dict[str, Any]],
) -> dict[str, Any]:
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                f"File: {file_name or 'policy'}\n"
                "These images are pages of a public design-policy PDF (not a floor plan). "
                "Read tables in the images as well as the selectable text.\n\n"
                f"{text[:TEXT_LIMIT]}"
            ),
        }
    ]
    for page in pages:
        content.append({"type": "text", "text": f"Page {page['pageNumber']}:"})
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{page['mime']};base64,{page['b64']}"},
            }
        )
    return {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": LLM_SYSTEM},
            {"role": "user", "content": content},
        ],
    }


def merge_llm_packs(packs: list[dict[str, Any]], file_name: str | None) -> dict[str, Any] | None:
    guidelines: list[dict[str, Any]] = []
    for pack in packs:
        for item in pack.get("guidelines") or []:
            if not isinstance(item, dict):
                continue
            row = dict(item)
            row["id"] = f"g-{len(guidelines) + 1}"
            guidelines.append(row)
    if not guidelines:
        return None
    return normalize_llm_pack({"name": packs[0].get("name") or file_name, "guidelines": guidelines}, file_name)


def message_text_from_llm_body(body: dict[str, Any]) -> str:
    choices = body.get("choices")
    if isinstance(choices, list) and choices:
        message = (choices[0] or {}).get("message") or {}
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content
    candidates = body.get("candidates")
    if isinstance(candidates, list) and candidates:
        parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
        texts = [p.get("text") for p in parts if isinstance(p, dict) and isinstance(p.get("text"), str)]
        joined = "\n".join(t for t in texts if t.strip())
        if joined.strip():
            return joined
    content = body.get("content")
    return content if isinstance(content, str) else ""


def _mapped_kind(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    kind = value.strip()
    if kind in {"", "null", "none"}:
        return None
    return kind if kind in MAPPED_KINDS else None


def _guideline_from_item(item: dict[str, Any], group: str, index: int) -> dict[str, Any]:
    text = str(item.get("text") or item.get("sourceText") or item.get("source_text") or "").strip()
    name = str(item.get("name") or (text[:72] if text else f"Guideline {index + 1}")).strip()
    mapped = _mapped_kind(item.get("mappedKind") or item.get("mapped_kind") or item.get("kind"))
    gid = str(item.get("id") or f"g-{index + 1}")
    line_ids = item.get("lineIds") or item.get("line_ids") or []
    return {
        "id": gid,
        "group": group,
        "name": name or f"Guideline {index + 1}",
        "text": text or name,
        "clause": item.get("clause"),
        "sourceText": item.get("sourceText") or item.get("source_text") or (text[:240] if text else None),
        "page": item.get("page"),
        "lineIds": line_ids if isinstance(line_ids, list) else [],
        "rects": item.get("rects") if isinstance(item.get("rects"), list) else [],
        "status": "pending",
        "mappedKind": mapped,
    }


def _rule_from_guideline(item: dict[str, Any], guideline: dict[str, Any]) -> dict[str, Any] | None:
    kind = guideline.get("mappedKind")
    if not kind:
        return None
    rule = {
        "code": item.get("code") or guideline.get("clause") or str(guideline["id"]).upper(),
        "name": guideline["name"],
        "kind": kind,
        "guidelineId": guideline["id"],
        "clause": guideline.get("clause"),
        "sourceText": guideline.get("sourceText"),
        "requiresScale": item.get("requiresScale", kind not in {"apartment_dual_aspect", "habitable_has_window"}),
    }
    for key in (
        "minAreaM2",
        "byBedrooms",
        "minCount",
        "m2PerDwelling",
        "requiredLabels",
        "minDimensionM",
        "minCommunalM2",
        "minWallCount",
        "roomLabels",
    ):
        if item.get(key) is not None:
            rule[key] = item[key]
    return rule


def normalize_llm_pack(data: dict[str, Any], file_name: str | None) -> dict[str, Any] | None:
    guidelines: list[dict[str, Any]] = []
    rules: list[dict[str, Any]] = []
    groups = data.get("groups")
    if isinstance(groups, list) and groups:
        for group in groups:
            if not isinstance(group, dict):
                continue
            title = str(group.get("title") or group.get("name") or group.get("group") or "General")
            items = group.get("guidelines") or group.get("items") or []
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                guideline = _guideline_from_item(item, title, len(guidelines))
                guidelines.append(guideline)
                rule = _rule_from_guideline(item, guideline)
                if rule:
                    rules.append(rule)
    elif isinstance(data.get("guidelines"), list):
        for item in data["guidelines"]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("group") or "General")
            guideline = _guideline_from_item(item, title, len(guidelines))
            guidelines.append(guideline)
            rule = _rule_from_guideline(item, guideline)
            if rule:
                rules.append(rule)

    existing_rules = data.get("rules")
    if isinstance(existing_rules, list):
        for rule in existing_rules:
            if isinstance(rule, dict):
                rules.append(rule)

    if not guidelines and not rules:
        return None

    out = dict(data)
    out["guidelines"] = guidelines
    out["rules"] = rules
    out.setdefault("name", file_name or "Uploaded policy")
    out.setdefault(
        "notes",
        [
            f"{len(guidelines)} guideline{'s' if len(guidelines) != 1 else ''} extracted. Review and accept before checking the plan."
        ]
        if guidelines
        else data.get("notes") or [],
    )
    return out


def pack_from_llm_content(content: str, file_name: str | None) -> dict[str, Any] | None:
    if not isinstance(content, str) or not content.strip():
        return None
    start = content.find("{")
    end = content.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(content[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    normalized = normalize_llm_pack(data, file_name)
    if not normalized:
        return None
    normalized.setdefault("source", {"kind": "llm", "fileName": file_name})
    normalized.setdefault("id", str(normalized.get("version") or file_name or "llm-policy"))
    return normalized


def _policy_llm_headers(url: str, api_key: str) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "HighLifeAIWeb/1.0 (https://github.com/highlife; policy-ingest)",
    }
    if api_key and not is_gemini_generate_url(url):
        headers["Authorization"] = f"Bearer {api_key}"
    if "openrouter.ai" in url:
        headers["HTTP-Referer"] = "https://highlife.local"
        headers["X-Title"] = "HighLife policy ingest"
    return headers


def _post_policy_llm(url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any] | None:
    try:
        with httpx.Client(timeout=120.0, follow_redirects=True) as client:
            res = client.post(url, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        logger.warning("Policy LLM request failed: %s", exc)
        return None
    if res.status_code >= 400:
        logger.warning("Policy LLM HTTP %s: %s", res.status_code, (res.text or "")[:400])
        return None
    try:
        body = res.json()
    except json.JSONDecodeError:
        logger.warning("Policy LLM returned non-JSON")
        return None
    return body if isinstance(body, dict) else None


def llm_from_text(text: str, file_name: str | None = None) -> dict[str, Any] | None:
    from app.config import get_settings

    settings = get_settings()
    if not settings.vlm_enabled or not (settings.vlm_api_key or settings.vlm_api_url):
        return None
    # Public policy text — never a floor-plan image.

    url = (settings.vlm_api_url or "").strip() or "https://api.openai.com/v1/chat/completions"
    headers = _policy_llm_headers(url, settings.vlm_api_key or "")
    gemini = is_gemini_generate_url(url)
    if gemini:
        url = gemini_url_with_key(url, settings.vlm_api_key or "")
        payload = gemini_generate_payload(text, file_name)
    else:
        payload = openai_chat_payload(text, file_name, settings.vlm_model or "gpt-4o-mini")
    body = _post_policy_llm(url, headers, payload)
    if not body:
        return None
    return pack_from_llm_content(message_text_from_llm_body(body), file_name)


def llm_from_pages(
    text: str,
    pages: list[dict[str, Any]],
    file_name: str | None = None,
) -> dict[str, Any] | None:
    from app.config import get_settings

    settings = get_settings()
    if not settings.vlm_enabled or not (settings.vlm_api_key or settings.vlm_api_url):
        return None
    normalized = normalize_policy_pages(pages)
    if not normalized:
        return None
    # Policy-document rasters only — floor-plan images stay behind VLM_ALLOW_REMOTE_IMAGES.

    url = (settings.vlm_api_url or "").strip() or "https://api.openai.com/v1/chat/completions"
    headers = _policy_llm_headers(url, settings.vlm_api_key or "")
    gemini = is_gemini_generate_url(url)
    if gemini:
        url = gemini_url_with_key(url, settings.vlm_api_key or "")
    model = settings.vlm_model or "gpt-4o-mini"
    packs: list[dict[str, Any]] = []
    for start in range(0, len(normalized), VISION_PAGES_PER_REQUEST):
        batch = normalized[start : start + VISION_PAGES_PER_REQUEST]
        payload = (
            gemini_vision_payload(text, file_name, batch)
            if gemini
            else openai_vision_payload(text, file_name, model, batch)
        )
        body = _post_policy_llm(url, headers, payload)
        if not body:
            continue
        pack = pack_from_llm_content(message_text_from_llm_body(body), file_name)
        if pack:
            packs.append(pack)
    if not packs:
        return None
    if len(packs) == 1:
        return packs[0]
    return merge_llm_packs(packs, file_name)


def ingest_policy_text(
    text: str,
    *,
    file_name: str | None = None,
    fmt: str | None = None,
    pages: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], str]:
    kind = (fmt or "").strip().lower()
    stripped = (text or "").lstrip()
    if kind in {"yaml", "yml", "json"} or stripped[:1] in "{[" or stripped.startswith("version:"):
        try:
            return pack_from_yaml_or_json(text, file_name), "yaml" if kind != "json" else "json"
        except (ValueError, json.JSONDecodeError, yaml.YAMLError):
            if kind in {"yaml", "yml", "json"}:
                raise
    vision = llm_from_pages(text, pages or [], file_name) if pages else None
    if vision and (vision.get("guidelines") or vision.get("rules")):
        return vision, "vision"
    llm = llm_from_text(text, file_name) if stripped else None
    if llm and (llm.get("guidelines") or llm.get("rules")):
        return llm, "llm"
    return heuristic_from_text(text, file_name), "heuristic"
