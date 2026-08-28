from __future__ import annotations

import argparse
import base64
import json
import random
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import yaml
from PIL import Image

from app.yolo.classes import CLASS_NAMES, LABEL_ALIASES, canonical_label

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_DATASET_YAML = REPO_ROOT / "configs" / "dataset.yaml"
PREFIX_TO_BUILDING = {
    "20": "B20",
    "21": "B21",
    "82": "B82",
    "98": "B98",
    "118": "B118",
}


@dataclass(frozen=True)
class ConvertStats:
    images: int
    instances: int
    skipped_labels: dict[str, int]
    train: int
    val: int
    empty_pages: int = 0
    total_json: int = 0


def building_id_from_stem(stem: str) -> str | None:
    prefix = stem.split("_")[0]
    return PREFIX_TO_BUILDING.get(prefix)


def load_fold(dataset_yaml: Path, fold: str) -> tuple[set[str], set[str]]:
    data = yaml.safe_load(dataset_yaml.read_text(encoding="utf-8"))
    splits = data.get("splits") or {}
    spec = splits.get(fold)
    if not spec:
        raise ValueError(f"Unknown fold {fold!r}. Known: {sorted(splits)}")
    return set(spec["train"]), set(spec["test"])


def looks_like_labelme(path: Path) -> bool:
    """Detect LabelMe JSON. imagePath/imageData often follow a large shapes[] array."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return False
    if '"shapes"' not in text:
        return False
    # Prefer a cheap head+tail scan so huge pages do not need a full parse.
    head = text[:8192]
    tail = text[-4096:] if len(text) > 8192 else text
    sample = head + "\n" + tail
    if '"imageData"' in sample or '"imagePath"' in sample:
        return True
    # Fallback: parse keys (compact or atypical key order).
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return False
    return isinstance(payload, dict) and "shapes" in payload and (
        "imageData" in payload or "imagePath" in payload
    )



def find_labelme_root(root: Path) -> Path | None:
    matches = [path for path in root.rglob("*.json") if looks_like_labelme(path)]
    if not matches:
        return None
    parents = {path.parent for path in matches}
    if len(parents) == 1:
        return next(iter(parents))
    return root


def _decode_image(payload: dict, json_path: Path | None = None) -> Image.Image:
    raw = payload.get("imageData")
    if raw:
        return Image.open(BytesIO(base64.b64decode(raw))).convert("RGB")
    image_path = payload.get("imagePath")
    if image_path:
        raw_path = Path(str(image_path))
        candidates = [raw_path]
        if json_path is not None:
            candidates.append(json_path.parent / raw_path.name)
            candidates.append(json_path.parent / raw_path)
        for candidate in candidates:
            try:
                if candidate.is_file():
                    return Image.open(candidate).convert("RGB")
            except OSError:
                continue
    raise FileNotFoundError("LabelMe JSON has no imageData and imagePath was not found next to the JSON.")


def _normalize_polygon(
    points: list[list[float]],
    width: int,
    height: int,
) -> list[float] | None:
    if len(points) < 3 or width < 1 or height < 1:
        return None
    coords: list[float] = []
    for pair in points:
        if len(pair) < 2:
            return None
        x = min(1.0, max(0.0, float(pair[0]) / width))
        y = min(1.0, max(0.0, float(pair[1]) / height))
        coords.extend((x, y))
    if len(coords) < 6:
        return None
    return coords


def _xywh_from_points(
    points: list[list[float]],
    width: int,
    height: int,
) -> list[float] | None:
    if len(points) < 2 or width < 1 or height < 1:
        return None
    xs = [float(pair[0]) for pair in points if len(pair) >= 2]
    ys = [float(pair[1]) for pair in points if len(pair) >= 2]
    if len(xs) < 2:
        return None
    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)
    box_w = x2 - x1
    box_h = y2 - y1
    if box_w <= 0 or box_h <= 0:
        return None
    return [
        min(1.0, max(0.0, ((x1 + x2) / 2) / width)),
        min(1.0, max(0.0, ((y1 + y2) / 2) / height)),
        min(1.0, max(0.0, box_w / width)),
        min(1.0, max(0.0, box_h / height)),
    ]


def _shape_points(shape: dict) -> list[list[float]] | None:
    shape_type = (shape.get("shape_type") or "polygon").lower()
    pts = shape.get("points") or []
    if shape_type in {"polygon", "linestrip", "mask"}:
        return pts if len(pts) >= 3 else None
    if shape_type == "rectangle" and len(pts) >= 2:
        x1, y1 = pts[0]
        x2, y2 = pts[1]
        return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
    return None


def _class_index(raw: str, names: tuple[str, ...] | list[str]) -> tuple[str | None, int | None]:
    name_to_id = {name: i for i, name in enumerate(names)}
    mapped = canonical_label(raw)
    if mapped is not None and mapped in name_to_id:
        return mapped, name_to_id[mapped]
    stripped = (raw or "").strip()
    alias = LABEL_ALIASES.get(stripped, stripped)
    if alias in name_to_id:
        return alias, name_to_id[alias]
    if stripped in name_to_id:
        return stripped, name_to_id[stripped]
    return None, None


def convert_labelme_dir(
    src: Path,
    out: Path,
    *,
    fold: str | None = "fold_1",
    dataset_yaml: Path | None = None,
    class_names: list[str] | tuple[str, ...] | None = None,
    val_fraction: float = 0.2,
    task: str = "segment",
) -> ConvertStats:
    """
    Convert one LabelMe JSON per page into YOLO files.

    YOLO is not a single JSON. Output is:
    - images/train|val/*.png
    - labels/train|val/*.txt  (one file per image)
    - data.yaml (class index — this is the dataset manifest)
    """
    src = src.resolve()
    out = out.resolve()
    names: list[str] = list(class_names) if class_names else list(CLASS_NAMES)
    use_fold = bool(fold) and fold not in {"random", "none"}
    train_buildings: set[str] = set()
    val_buildings: set[str] = set()
    if use_fold:
        train_buildings, val_buildings = load_fold(dataset_yaml or DEFAULT_DATASET_YAML, fold or "fold_1")

    images_train = out / "images" / "train"
    images_val = out / "images" / "val"
    labels_train = out / "labels" / "train"
    labels_val = out / "labels" / "val"
    for folder in (images_train, images_val, labels_train, labels_val):
        folder.mkdir(parents=True, exist_ok=True)

    skipped: dict[str, int] = {}
    n_images = 0
    n_instances = 0
    n_train = 0
    n_val = 0
    n_empty = 0
    pending: list[tuple[str, Image.Image, list[str]]] = []

    files = sorted(path for path in src.glob("*.json") if looks_like_labelme(path) or path.suffix == ".json")
    if not files:
        raise FileNotFoundError(f"No LabelMe JSON files in {src}")

    for json_path in files:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or "shapes" not in payload:
            continue
        image = _decode_image(payload, json_path)
        width = int(payload.get("imageWidth") or image.width)
        height = int(payload.get("imageHeight") or image.height)
        if image.size != (width, height):
            image = image.resize((width, height), Image.Resampling.NEAREST)

        lines: list[str] = []
        shape_count = len(payload.get("shapes") or [])
        for shape in payload.get("shapes") or []:
            raw = str(shape.get("label") or "")
            _name, class_id = _class_index(raw, names)
            if class_id is None:
                skipped[raw.strip() or "<empty>"] = skipped.get(raw.strip() or "<empty>", 0) + 1
                continue
            pts = _shape_points(shape)
            if not pts:
                continue
            if task == "detect":
                values = _xywh_from_points(pts, width, height)
            else:
                values = _normalize_polygon(pts, width, height)
            if values is None:
                continue
            lines.append(f"{class_id} " + " ".join(f"{c:.6f}" for c in values))
            n_instances += 1

        if not lines:
            if shape_count > 0:
                n_empty += 1
            continue
        pending.append((json_path.stem, image, lines))

    if use_fold:
        split_of = []
        for stem, image, lines in pending:
            building = building_id_from_stem(stem)
            split = "val" if building in val_buildings else "train"
            split_of.append(split)
    else:
        rng = random.Random(42)
        order = list(range(len(pending)))
        rng.shuffle(order)
        val_count = max(1, int(round(len(pending) * val_fraction))) if len(pending) >= 2 else 0
        val_ids = set(order[:val_count])
        split_of = ["val" if i in val_ids else "train" for i in range(len(pending))]

    for (stem, image, lines), split in zip(pending, split_of, strict=True):
        img_dir = images_val if split == "val" else images_train
        lbl_dir = labels_val if split == "val" else labels_train
        image.save(img_dir / f"{stem}.png", format="PNG")
        (lbl_dir / f"{stem}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
        n_images += 1
        if split == "val":
            n_val += 1
        else:
            n_train += 1

    # Ultralytics always builds a val loader — an empty images/val fails hard.
    # With one labelled page (or a bad split), mirror at least one train sample into val.
    if n_val == 0 and n_train > 0:
        for src in sorted(images_train.glob("*")):
            if not src.is_file():
                continue
            dest = images_val / src.name
            if not dest.exists():
                dest.write_bytes(src.read_bytes())
            lbl_src = labels_train / f"{src.stem}.txt"
            lbl_dest = labels_val / f"{src.stem}.txt"
            if lbl_src.is_file() and not lbl_dest.exists():
                lbl_dest.write_text(lbl_src.read_text(encoding="utf-8"), encoding="utf-8")
            n_val += 1
            break

    if n_images == 0:
        raise ValueError(
            "No convertible LabelMe pages (all shapes skipped or empty). "
            "Check class names match the dataset legend."
        )

    data_yaml = {
        "path": str(out).replace("\\", "/"),
        "train": "images/train",
        "val": "images/val" if n_val > 0 else "images/train",
        "names": {i: name for i, name in enumerate(names)},
    }
    (out / "data.yaml").write_text(yaml.safe_dump(data_yaml, sort_keys=False), encoding="utf-8")
    (out / "classes.txt").write_text("\n".join(names) + "\n", encoding="utf-8")

    return ConvertStats(
        images=n_images,
        instances=n_instances,
        skipped_labels=skipped,
        train=n_train,
        val=n_val,
        empty_pages=n_empty,
        total_json=len(files),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Convert LabelMe JSON files (one per page) to YOLO images + labels + data.yaml"
    )
    parser.add_argument("--src", required=True, type=Path, help="Directory of LabelMe .json files")
    parser.add_argument("--out", type=Path, default=Path("data/yolo_seg"))
    parser.add_argument("--fold", default="fold_1", help="Building fold from configs/dataset.yaml, or 'random'")
    parser.add_argument("--dataset-yaml", type=Path, default=DEFAULT_DATASET_YAML)
    parser.add_argument("--task", choices=["detect", "segment"], default="segment")
    args = parser.parse_args(argv)

    stats = convert_labelme_dir(
        args.src,
        args.out,
        fold=None if args.fold == "random" else args.fold,
        dataset_yaml=args.dataset_yaml,
        task=args.task,
    )
    print(
        f"Wrote {stats.images} images ({stats.train} train / {stats.val} val), "
        f"{stats.instances} instances → {args.out}"
    )
    print("YOLO uses one .txt per image plus data.yaml — not a single merged JSON.")
    if stats.skipped_labels:
        skipped = ", ".join(f"{k}:{v}" for k, v in sorted(stats.skipped_labels.items()))
        print(f"Skipped labels: {skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
