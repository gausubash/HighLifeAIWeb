from __future__ import annotations

from pathlib import Path

from app.config import get_settings


ALLOWED_MIME = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
}

MAX_UPLOAD_BYTES = 80 * 1024 * 1024


def save_bytes(relative_dir: str, filename: str, data: bytes) -> Path:
    root = get_settings().storage_dir.resolve()
    dest_dir = root / relative_dir
    dest_dir.mkdir(parents=True, exist_ok=True)
    path = dest_dir / filename
    path.write_bytes(data)
    return path


def storage_relative(path: Path) -> str:
    root = get_settings().storage_dir.resolve()
    return path.resolve().relative_to(root).as_posix()


def resolve_storage_path(stored: str) -> Path:
    path = Path(stored)
    if path.is_absolute():
        return path
    return (get_settings().storage_dir / stored).resolve()
