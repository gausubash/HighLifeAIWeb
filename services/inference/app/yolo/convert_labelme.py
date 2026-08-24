from __future__ import annotations

import argparse
import base64
import json
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import yaml
from PIL import Image

from app.yolo.classes import CLASS_NAMES, CLASS_TO_ID, canonical_label

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


def _decode_image(payload: dict) -> Image.Image:
    raw = payload.get("imageData")
    if raw:
        return Image.open(BytesIO(base64.b64decode(raw))).convert("RGB")
    image_path = payload.get("imagePath")
    if image_path:
        path = Path(image_path)
        if path.is_file():
            return Image.open(path).convert("RGB")
    raise FileNotFoundError("LabelMe JSON has no imageData and imagePath was not found.")


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


def convert_labelme_dir(
    src: Path,
    out: Path,
    *,
    fold: str = "fold_1",
    dataset_yaml: Path | None = None,
) -> ConvertStats:
    src = src.resolve()
    out = out.resolve()
    train_buildings, val_buildings = load_fold(dataset_yaml or DEFAULT_DATASET_YAML, fold)

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

    files = sorted(src.glob("*.json"))
    if not files:
        raise FileNotFoundError(f"No LabelMe JSON files in {src}")

    for json_path in files:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        image = _decode_image(payload)
        width = int(payload.get("imageWidth") or image.width)
        height = int(payload.get("imageHeight") or image.height)
        if image.size != (width, height):
            image = image.resize((width, height), Image.Resampling.NEAREST)

        building = building_id_from_stem(json_path.stem)
        split = "val" if building in val_buildings else "train"
        img_dir = images_val if split == "val" else images_train
        lbl_dir = labels_val if split == "val" else labels_train

        lines: list[str] = []
        for shape in payload.get("shapes") or []:
            label = canonical_label(str(shape.get("label") or ""))
            if label is None:
                raw = str(shape.get("label") or "").strip() or "<empty>"
                skipped[raw] = skipped.get(raw, 0) + 1
                continue
            pts = _shape_points(shape)
            if not pts:
                continue
            coords = _normalize_polygon(pts, width, height)
            if coords is None:
                continue
            class_id = CLASS_TO_ID[label]
            lines.append(f"{class_id} " + " ".join(f"{c:.6f}" for c in coords))
            n_instances += 1

        if not lines:
            continue

        stem = json_path.stem
        image.save(img_dir / f"{stem}.png", format="PNG")
        (lbl_dir / f"{stem}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
        n_images += 1
        if split == "val":
            n_val += 1
        else:
            n_train += 1

    data_yaml = {
        "path": str(out).replace("\\", "/"),
        "train": "images/train",
        "val": "images/val",
        "names": {i: name for i, name in enumerate(CLASS_NAMES)},
    }
    (out / "data.yaml").write_text(yaml.safe_dump(data_yaml, sort_keys=False), encoding="utf-8")
    (out / "classes.txt").write_text("\n".join(CLASS_NAMES) + "\n", encoding="utf-8")

    return ConvertStats(
        images=n_images,
        instances=n_instances,
        skipped_labels=skipped,
        train=n_train,
        val=n_val,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Convert LabelMe JSON (+ imageData) to YOLO-seg")
    parser.add_argument("--src", required=True, type=Path, help="Directory of LabelMe .json files")
    parser.add_argument("--out", type=Path, default=Path("data/yolo_seg"))
    parser.add_argument("--fold", default="fold_1")
    parser.add_argument("--dataset-yaml", type=Path, default=DEFAULT_DATASET_YAML)
    args = parser.parse_args(argv)

    stats = convert_labelme_dir(args.src, args.out, fold=args.fold, dataset_yaml=args.dataset_yaml)
    print(
        f"Wrote {stats.images} images ({stats.train} train / {stats.val} val), "
        f"{stats.instances} instances → {args.out}"
    )
    if stats.skipped_labels:
        skipped = ", ".join(f"{k}:{v}" for k, v in sorted(stats.skipped_labels.items()))
        print(f"Skipped labels: {skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
