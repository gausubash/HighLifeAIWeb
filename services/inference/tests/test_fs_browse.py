from __future__ import annotations

from pathlib import Path

from app.studio.fs_browse import list_directory, roots


def test_roots_include_home() -> None:
    items = roots()
    assert any(item["name"] == "Home" for item in items)


def test_list_directory(tmp_path: Path) -> None:
    (tmp_path / "a").mkdir()
    (tmp_path / "plan.pdf").write_bytes(b"%PDF-1.4")
    (tmp_path / "skip.txt").write_text("x", encoding="utf-8")
    listing = list_directory(str(tmp_path))
    names = {entry["name"] for entry in listing["entries"]}
    assert "a" in names
    assert "plan.pdf" in names
    assert "skip.txt" not in names
