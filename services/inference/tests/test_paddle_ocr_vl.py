"""Unit tests for PaddleOCR-VL result normalization (no paddle dependency)."""

from __future__ import annotations

from app.pipeline.paddle_ocr import resolve_ocr_backend
from app.pipeline.paddle_ocr_vl import (
    align_pipeline_version,
    layout_compatible_with_pipeline,
    normalize_vl_result,
    read_paddlex_model_name,
    rec_compatible_with_pipeline,
    _to_quad,
)


def test_to_quad_xyxy() -> None:
    assert _to_quad([10, 20, 40, 50]) == [[10, 20], [40, 20], [40, 50], [10, 50]]


def test_to_quad_polygon() -> None:
    poly = [[1, 2], [3, 2], [3, 4], [1, 4]]
    assert _to_quad(poly) == poly


def test_normalize_prefers_ocr_res_lines() -> None:
    raw = {
        "ocr_res": {
            "rec_texts": ["SCALE 1:100", "@ A1"],
            "rec_scores": [0.98, 0.91],
            "rec_polys": [
                [[10, 10], [80, 10], [80, 22], [10, 22]],
                [[10, 24], [40, 24], [40, 34], [10, 34]],
            ],
        },
        "parsing_res_list": [
            {"block_label": "text", "block_content": "should not win", "block_bbox": [0, 0, 1, 1]},
        ],
    }
    lines = normalize_vl_result(raw)
    assert [row["text"] for row in lines] == ["SCALE 1:100", "@ A1"]
    assert lines[0]["bbox"][2] == [80, 22]
    assert lines[0]["confidence"] == 0.98


def test_normalize_parsing_blocks_split_lines() -> None:
    raw = [
        {
            "parsing_res_list": [
                {
                    "block_label": "text",
                    "block_content": "SCALE 1:100\n@ A1",
                    "block_bbox": [5, 6, 50, 30],
                },
                {"block_label": "figure", "block_content": "logo", "block_bbox": [0, 0, 10, 10]},
            ]
        }
    ]
    lines = normalize_vl_result(raw)
    assert [row["text"] for row in lines] == ["SCALE 1:100", "@ A1"]
    assert lines[0]["bbox"][0] == [5, 6]


def test_resolve_ocr_backend() -> None:
    from types import SimpleNamespace

    classic = SimpleNamespace(paddle_ocr_backend="classic")
    vl = SimpleNamespace(paddle_ocr_backend="vl")
    assert resolve_ocr_backend(settings=classic, ocr_options={"backend": "vl"}) == "vl"
    assert resolve_ocr_backend(settings=classic, ocr_options={"backend": "PaddleOCR-VL"}) == "vl"
    assert resolve_ocr_backend(settings=vl, ocr_options={"backend": "classic"}) == "classic"
    assert resolve_ocr_backend(settings=classic, ocr_options={}) == "classic"
    assert resolve_ocr_backend(settings=vl, ocr_options={}) == "vl"


def test_resolve_local_vl_weights(tmp_path) -> None:
    from app.pipeline.paddle_ocr_vl import looks_like_vl_weights, resolve_vl_model_dir

    empty = tmp_path / "empty"
    empty.mkdir()
    assert looks_like_vl_weights(empty) is False
    assert resolve_vl_model_dir(str(empty), default=empty) is None

    weights = tmp_path / "paddleocr-vl"
    weights.mkdir()
    (weights / "config.json").write_text("{}", encoding="utf-8")
    (weights / "model.safetensors").write_bytes(b"x")
    assert looks_like_vl_weights(weights) is True
    assert resolve_vl_model_dir(str(weights), default=tmp_path / "missing") == str(weights.resolve())


def test_read_paddlex_model_name(tmp_path) -> None:
    layout = tmp_path / "PP-DocLayoutV2"
    layout.mkdir()
    (layout / "inference.yml").write_text(
        "Global:\n  model_name: PP-DocLayoutV2\n",
        encoding="utf-8",
    )
    assert read_paddlex_model_name(layout) == "PP-DocLayoutV2"
    named_only = tmp_path / "PP-DocLayoutV3"
    named_only.mkdir()
    assert read_paddlex_model_name(named_only) == "PP-DocLayoutV3"


def test_align_pipeline_version_to_local_layout() -> None:
    assert align_pipeline_version("v1.6", "PP-DocLayoutV2") == "v1"
    assert align_pipeline_version("v1.5", "PP-DocLayoutV2") == "v1"
    assert align_pipeline_version("v1", "PP-DocLayoutV2") == "v1"
    assert align_pipeline_version("v1", "PP-DocLayoutV3") == "v1.6"
    assert align_pipeline_version("v1.5", "PP-DocLayoutV3") == "v1.5"
    assert align_pipeline_version("v1.6", None) == "v1.6"


def test_rec_compatible_with_pipeline() -> None:
    assert rec_compatible_with_pipeline("PaddleOCR-VL-0.9B", "v1") is True
    assert rec_compatible_with_pipeline("PaddleOCR-VL-0.9B", "v1.6") is False
    assert rec_compatible_with_pipeline("PaddleOCR-VL-1.6-0.9B", "v1.6") is True
    assert rec_compatible_with_pipeline("PaddleOCR-VL-1.6-0.9B", "v1") is False
    assert rec_compatible_with_pipeline(None, "v1.6") is False
    assert layout_compatible_with_pipeline("PP-DocLayoutV2", "v1.6") is False
    assert layout_compatible_with_pipeline("PP-DocLayoutV3", "v1.6") is True
    assert layout_compatible_with_pipeline("PP-DocLayoutV2", "v1") is True
