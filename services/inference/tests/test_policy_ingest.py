from app.pipeline.policy_ingest import (
    decode_policy_page_image,
    gemini_vision_payload,
    heuristic_from_text,
    is_gemini_generate_url,
    merge_llm_packs,
    message_text_from_llm_body,
    normalize_llm_pack,
    openai_vision_payload,
    pack_from_llm_content,
    pack_from_yaml_or_json,
)


def test_pack_from_json() -> None:
    pack = pack_from_yaml_or_json(
        '{"version":"x","name":"X","rules":[{"code":"A","name":"A","kind":"apartment_min_bedroom","minAreaM2":9}]}',
        "x.json",
    )
    assert pack["version"] == "x"
    assert len(pack["rules"]) == 1


def test_heuristic_bedroom_and_aspect() -> None:
    pack = heuristic_from_text(
        "Bedrooms must be 10 m2 minimum. Dual aspect apartments are required.",
        "policy.pdf",
    )
    kinds = {r["kind"] for r in pack["rules"]}
    assert "apartment_min_bedroom" in kinds
    assert "apartment_dual_aspect" in kinds


def test_gemini_generate_url_detection() -> None:
    assert is_gemini_generate_url(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent"
    )
    assert not is_gemini_generate_url(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    )


def test_pack_from_gemini_candidates() -> None:
    body = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": '{"version":"g","name":"Gemini","rules":[{"code":"A","name":"A","kind":"apartment_min_bedroom","minAreaM2":9}]}'
                        }
                    ]
                }
            }
        ]
    }
    pack = pack_from_llm_content(message_text_from_llm_body(body), "bads.pdf")
    assert pack is not None
    assert pack["name"] == "Gemini"
    assert pack["source"]["kind"] == "llm"


def test_normalize_grouped_guidelines() -> None:
    pack = normalize_llm_pack(
        {
            "version": "g1",
            "name": "Grouped",
            "groups": [
                {
                    "title": "4.2 Internal areas",
                    "guidelines": [
                        {
                            "name": "Apartment size",
                            "text": "Apartments shall have 50 m2 internal area.",
                            "mappedKind": "apartment_min_internal",
                            "lineIds": ["p2L4"],
                            "minAreaM2": 50,
                        },
                        {
                            "name": "Quiet",
                            "text": "Bedrooms should be located away from lifts.",
                            "mappedKind": None,
                        },
                    ],
                }
            ],
        },
        "rds.pdf",
    )
    assert pack is not None
    assert len(pack["guidelines"]) == 2
    assert pack["guidelines"][0]["group"] == "4.2 Internal areas"
    assert pack["guidelines"][0]["status"] == "pending"
    assert pack["rules"][0]["kind"] == "apartment_min_internal"
    assert pack["rules"][0]["guidelineId"] == pack["guidelines"][0]["id"]
    assert pack["guidelines"][1]["mappedKind"] is None


def test_decode_policy_page_image() -> None:
    mime, b64 = decode_policy_page_image("data:image/png;base64,abc123")
    assert mime == "image/png"
    assert b64 == "abc123"


def test_openai_and_gemini_vision_payloads_include_page_images() -> None:
    pages = [{"pageNumber": 2, "mime": "image/jpeg", "b64": "abc"}]
    openai = openai_vision_payload("[p2 L1] table", "rds.pdf", "gpt-4o-mini", pages)
    content = openai["messages"][1]["content"]
    assert any(part.get("type") == "image_url" for part in content)
    gemini = gemini_vision_payload("[p2 L1] table", "rds.pdf", pages)
    parts = gemini["contents"][0]["parts"]
    assert any("inlineData" in part for part in parts)


def test_merge_llm_packs_reindexes() -> None:
    merged = merge_llm_packs(
        [
            {
                "name": "A",
                "guidelines": [{"id": "g-1", "group": "Size", "name": "Studio", "text": "35 m2"}],
            },
            {
                "name": "B",
                "guidelines": [{"id": "g-1", "group": "POS", "name": "Balcony", "text": "8 m2"}],
            },
        ],
        "rds.pdf",
    )
    assert merged is not None
    assert [g["id"] for g in merged["guidelines"]] == ["g-1", "g-2"]
    assert merged["guidelines"][1]["group"] == "POS"
