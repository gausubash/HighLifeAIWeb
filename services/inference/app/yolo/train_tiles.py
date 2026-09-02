"""Overlapping train crops so Studio fine-tunes match tiled inference resolution."""

from __future__ import annotations

import random
import shutil
from pathlib import Path

from PIL import Image

from app.yolo.tiling import iter_tiles, should_tile


def _parse_yolo_line(line: str) -> tuple[int, list[float]] | None:
    parts = line.strip().split()
    if len(parts) < 5:
        return None
    try:
        class_id = int(float(parts[0]))
        coords = [float(x) for x in parts[1:]]
    except ValueError:
        return None
    return class_id, coords


def _clip_norm_poly_to_tile(
    coords: list[float],
    *,
    img_w: int,
    img_h: int,
    x0: int,
    y0: int,
    tile_w: int,
    tile_h: int,
) -> list[float] | None:
    if len(coords) < 6 or tile_w < 1 or tile_h < 1:
        return None
    pts: list[tuple[float, float]] = []
    for i in range(0, len(coords) - 1, 2):
        px = coords[i] * img_w
        py = coords[i + 1] * img_h
        # Clip into tile AABB.
        cx = min(float(x0 + tile_w), max(float(x0), px))
        cy = min(float(y0 + tile_h), max(float(y0), py))
        pts.append(((cx - x0) / tile_w, (cy - y0) / tile_h))
    # Drop if all points collapsed or outside (no area).
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    if max(xs) - min(xs) < 0.01 or max(ys) - min(ys) < 0.01:
        return None
    # Keep only if original bbox meaningfully intersects tile.
    ox = [coords[i] * img_w for i in range(0, len(coords) - 1, 2)]
    oy = [coords[i + 1] * img_h for i in range(0, len(coords) - 1, 2)]
    if max(ox) < x0 or min(ox) > x0 + tile_w or max(oy) < y0 or min(oy) > y0 + tile_h:
        return None
    out: list[float] = []
    for x, y in pts:
        out.extend((min(1.0, max(0.0, x)), min(1.0, max(0.0, y))))
    return out if len(out) >= 6 else None


def _clip_norm_pose_to_tile(
    coords: list[float],
    *,
    img_w: int,
    img_h: int,
    x0: int,
    y0: int,
    tile_w: int,
    tile_h: int,
    canvas: int,
) -> list[float] | None:
    box = _clip_norm_xywh_to_tile(
        coords[:4],
        img_w=img_w,
        img_h=img_h,
        x0=x0,
        y0=y0,
        tile_w=tile_w,
        tile_h=tile_h,
    )
    if box is None:
        return None
    if tile_w != canvas or tile_h != canvas:
        cx, cy, bw, bh = box
        box = [
            cx * tile_w / canvas,
            cy * tile_h / canvas,
            bw * tile_w / canvas,
            bh * tile_h / canvas,
        ]
    out = list(box)
    rest = coords[4:]
    for i in range(0, len(rest) - 2, 3):
        px = rest[i] * img_w
        py = rest[i + 1] * img_h
        vis = rest[i + 2]
        nx = (px - x0) / max(tile_w, 1)
        ny = (py - y0) / max(tile_h, 1)
        if nx < 0 or nx > 1 or ny < 0 or ny > 1:
            vis = 0.0
        nx = min(1.0, max(0.0, nx)) * tile_w / canvas
        ny = min(1.0, max(0.0, ny)) * tile_h / canvas
        out.extend((nx, ny, vis))
    return out


def _clip_norm_xywh_to_tile(
    coords: list[float],
    *,
    img_w: int,
    img_h: int,
    x0: int,
    y0: int,
    tile_w: int,
    tile_h: int,
) -> list[float] | None:
    if len(coords) < 4 or tile_w < 1 or tile_h < 1:
        return None
    cx, cy, bw, bh = coords[:4]
    x1 = (cx - bw / 2) * img_w
    y1 = (cy - bh / 2) * img_h
    x2 = (cx + bw / 2) * img_w
    y2 = (cy + bh / 2) * img_h
    ix1 = max(x1, float(x0))
    iy1 = max(y1, float(y0))
    ix2 = min(x2, float(x0 + tile_w))
    iy2 = min(y2, float(y0 + tile_h))
    if ix2 - ix1 < 2 or iy2 - iy1 < 2:
        return None
    ncx = ((ix1 + ix2) / 2 - x0) / tile_w
    ncy = ((iy1 + iy2) / 2 - y0) / tile_h
    nbw = (ix2 - ix1) / tile_w
    nbh = (iy2 - iy1) / tile_h
    return [
        min(1.0, max(0.0, ncx)),
        min(1.0, max(0.0, ncy)),
        min(1.0, max(0.0, nbw)),
        min(1.0, max(0.0, nbh)),
    ]


def expand_yolo_split_with_tiles(
    images_dir: Path,
    labels_dir: Path,
    *,
    tile_size: int = 640,
    overlap: float = 0.2,
    min_side: int = 1280,
    keep_full_page_frac: float = 0.15,
    task: str = "segment",
    seed: int = 42,
) -> dict[str, int]:
    """
    For each large image in a YOLO split, write overlapping tile crops + clipped labels.
    Optionally keep a fraction of original full pages (downscale left to the trainer).
    """
    images = sorted(
        p
        for p in images_dir.iterdir()
        if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
    )
    if not images:
        return {"images": 0, "tiles": 0, "kept_full": 0}

    rng = random.Random(seed)
    tile_count = 0
    kept_full = 0
    for image_path in images:
        label_path = labels_dir / f"{image_path.stem}.txt"
        if not label_path.is_file():
            continue
        with Image.open(image_path) as im:
            rgb = im.convert("RGB")
            w, h = rgb.size
        lines = [
            ln
            for ln in label_path.read_text(encoding="utf-8").splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]
        if not should_tile(h, w, tile_size=tile_size, min_side=min_side):
            kept_full += 1
            continue

        keep_full = rng.random() < max(0.0, min(1.0, keep_full_page_frac))
        tiles = iter_tiles(h, w, tile_size, overlap)
        for idx, tile in enumerate(tiles):
            crop = rgb.crop((tile.x0, tile.y0, tile.x1, tile.y1))
            # Pad to square tile_size for consistent training.
            canvas = Image.new("RGB", (tile_size, tile_size), (255, 255, 255))
            canvas.paste(crop, (0, 0))
            out_lines: list[str] = []
            for line in lines:
                parsed = _parse_yolo_line(line)
                if not parsed:
                    continue
                class_id, coords = parsed
                if task == "pose" or len(coords) >= 10:
                    clipped = _clip_norm_pose_to_tile(
                        coords,
                        img_w=w,
                        img_h=h,
                        x0=tile.x0,
                        y0=tile.y0,
                        tile_w=tile.width,
                        tile_h=tile.height,
                        canvas=tile_size,
                    )
                elif task == "detect" or len(coords) == 4:
                    clipped = _clip_norm_xywh_to_tile(
                        coords,
                        img_w=w,
                        img_h=h,
                        x0=tile.x0,
                        y0=tile.y0,
                        tile_w=tile.width,
                        tile_h=tile.height,
                    )
                else:
                    clipped = _clip_norm_poly_to_tile(
                        coords,
                        img_w=w,
                        img_h=h,
                        x0=tile.x0,
                        y0=tile.y0,
                        tile_w=tile.width,
                        tile_h=tile.height,
                    )
                    # Remap from tile crop size into padded tile_size canvas.
                    if clipped and (tile.width != tile_size or tile.height != tile_size):
                        remapped: list[float] = []
                        for i in range(0, len(clipped) - 1, 2):
                            remapped.append(clipped[i] * tile.width / tile_size)
                            remapped.append(clipped[i + 1] * tile.height / tile_size)
                        clipped = remapped
                if clipped is None:
                    continue
                if task == "detect" or len(clipped) == 4:
                    # Scale xywh into padded canvas.
                    if tile.width != tile_size or tile.height != tile_size:
                        cx, cy, bw, bh = clipped
                        clipped = [
                            cx * tile.width / tile_size,
                            cy * tile.height / tile_size,
                            bw * tile.width / tile_size,
                            bh * tile.height / tile_size,
                        ]
                out_lines.append(f"{class_id} " + " ".join(f"{c:.6f}" for c in clipped))
            if not out_lines:
                continue
            stem = f"{image_path.stem}_tile{idx:03d}"
            canvas.save(images_dir / f"{stem}.png")
            (labels_dir / f"{stem}.txt").write_text("\n".join(out_lines) + "\n", encoding="utf-8")
            tile_count += 1

        if not keep_full:
            image_path.unlink(missing_ok=True)
            label_path.unlink(missing_ok=True)
        else:
            kept_full += 1

    return {"images": len(images), "tiles": tile_count, "kept_full": kept_full}


def maybe_expand_data_yaml_with_tiles(
    data_yaml: Path,
    *,
    settings,
    task: str = "segment",
) -> Path:
    """If TRAIN_TILE_ENABLED, expand train/val image splits in-place under data.yaml path."""
    if not bool(getattr(settings, "train_tile_enabled", True)):
        return data_yaml
    import yaml

    data = yaml.safe_load(data_yaml.read_text(encoding="utf-8")) or {}
    root = Path(str(data.get("path") or data_yaml.parent))
    tile_size = int(getattr(settings, "train_tile_size", 640) or 640)
    overlap = float(getattr(settings, "train_tile_overlap", 0.2) or 0.2)
    min_side = int(getattr(settings, "train_tile_min_side", 1280) or 1280)
    keep_frac = float(getattr(settings, "train_keep_full_page_frac", 0.15) or 0.15)

    for split in ("train", "val"):
        rel = str(data.get(split) or f"images/{split}")
        images_dir = root / rel
        # labels often mirror images path: images/train → labels/train
        labels_rel = rel.replace("images", "labels", 1)
        labels_dir = root / labels_rel
        if not images_dir.is_dir() or not labels_dir.is_dir():
            continue
        expand_yolo_split_with_tiles(
            images_dir,
            labels_dir,
            tile_size=tile_size,
            overlap=overlap,
            min_side=min_side,
            keep_full_page_frac=keep_frac,
            task=task,
        )
    return data_yaml
