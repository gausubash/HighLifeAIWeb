from __future__ import annotations

import os
import string
from pathlib import Path

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
LINKABLE_SUFFIXES = IMAGE_SUFFIXES | {".pdf"}


def roots() -> list[dict[str, str | bool]]:
    items: list[dict[str, str | bool]] = []
    home = Path.home()
    if home.is_dir():
        items.append({"name": "Home", "path": str(home), "is_dir": True, "kind": "root"})
    if os.name == "nt":
        for letter in string.ascii_uppercase:
            drive = Path(f"{letter}:\\")
            if drive.exists():
                items.append(
                    {
                        "name": f"{letter}:",
                        "path": str(drive),
                        "is_dir": True,
                        "kind": "drive",
                    }
                )
    else:
        root = Path("/")
        if root.is_dir():
            items.append({"name": "/", "path": "/", "is_dir": True, "kind": "root"})
    return items


def list_directory(raw: str | None) -> dict:
    if not raw or not str(raw).strip():
        return {"path": "", "parent": None, "entries": roots()}

    path = Path(str(raw).strip().strip('"')).expanduser()
    try:
        path = path.resolve()
    except OSError as exc:
        raise FileNotFoundError(str(exc)) from exc
    if not path.exists():
        raise FileNotFoundError(f"Path not found: {path}")
    if not path.is_dir():
        raise NotADirectoryError(f"Not a folder: {path}")

    entries: list[dict[str, object]] = []
    try:
        children = sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except PermissionError as exc:
        raise PermissionError(f"Permission denied: {path}") from exc

    for child in children:
        name = child.name
        if name.startswith("."):
            continue
        try:
            is_dir = child.is_dir()
        except OSError:
            continue
        suffix = child.suffix.lower()
        kind = "dir" if is_dir else ("pdf" if suffix == ".pdf" else ("image" if suffix in IMAGE_SUFFIXES else "file"))
        if not is_dir and suffix not in LINKABLE_SUFFIXES | {".json"}:
            continue
        entries.append(
            {
                "name": name,
                "path": str(child),
                "is_dir": is_dir,
                "kind": kind,
                "linkable": is_dir or suffix in LINKABLE_SUFFIXES,
            }
        )

    parent = str(path.parent) if path.parent != path else None
    if os.name == "nt" and path.parent == path:
        parent = ""
    return {
        "path": str(path),
        "parent": parent,
        "entries": entries,
    }
