"""Tests for scale resolution chain."""

from app.pipeline.scale_resolver import resolve_from_text, resolve_scale_chain

A1_W, A1_H = 7016, 9933


def test_resolve_from_title_block():
    res = resolve_from_text(
        "Scale 1:100 @ A1",
        width_px=A1_W,
        height_px=A1_H,
        dpi=300,
    )
    assert res is not None
    assert res.method == "title_block_text"
    assert res.confidence >= 0.8
    assert res.pixels_per_unit > 0


def test_resolve_chain_title_block_wins():
    res = resolve_scale_chain(
        width_px=A1_W,
        height_px=A1_H,
        width_mm=594.0,
        height_mm=841.0,
        paper_size="A1",
        title_block_text="1:100 @ A1",
        dpi=300,
    )
    assert res is not None
    assert res.method == "title_block_text"
