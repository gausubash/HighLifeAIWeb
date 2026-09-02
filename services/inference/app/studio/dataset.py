from __future__ import annotations

import io
import random
import shutil
import zipfile
from pathlib import Path

import yaml

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def parse_class_names(raw: str | list[str]) -> list[str]:
    if isinstance(raw, list):
        parts = raw
    else:
        parts = raw.replace(",", "\n").splitlines()
    names: list[str] = []
    seen: set[str] = set()
    for part in parts:
        name = " ".join(str(part).strip().split())
        if not name or name in seen:
            continue
        seen.add(name)
        names.append(name)
    if not names:
        raise ValueError("Add at least one class name.")
    return names


def _norm_class_key(name: str) -> str:
    return " ".join(name.strip().lower().replace("_", " ").split())


def is_north_arrow_class(name: str) -> bool:
    key = _norm_class_key(name)
    return key in {"north", "compass", "north arrow"} or key.startswith("north arrow")


def foreign_stock_class_names(category: str | None) -> set[str]:
    """Stock legend names that belong to a different Studio purpose."""
    from app.studio.model_catalog import DATASET_CATEGORY_DEFAULTS, normalize_category

    current = normalize_category(category)
    other: set[str] = set()
    for cat, spec in DATASET_CATEGORY_DEFAULTS.items():
        if cat == current:
            continue
        for raw in spec.get("class_names") or []:
            other.add(str(raw))
            other.add(_norm_class_key(str(raw)))
    return other


def class_names_for_training(dataset: dict) -> list[str]:
    """Legend used for YOLO convert / train — drop leftover classes from another purpose."""
    from app.studio.model_catalog import (
        CATEGORY_NORTH_ARROW,
        DATASET_CATEGORY_DEFAULTS,
        normalize_category,
    )

    category = normalize_category(str(dataset.get("category") or "") or None)
    raw = [str(name) for name in (dataset.get("class_names") or []) if str(name).strip()]
    defaults = [str(name) for name in (DATASET_CATEGORY_DEFAULTS.get(category or "", {}).get("class_names") or [])]
    foreign = foreign_stock_class_names(category)

    if category == CATEGORY_NORTH_ARROW:
        kept: list[str] = []
        seen: set[str] = set()
        for name in [*raw, *defaults, "North Arrow"]:
            if not is_north_arrow_class(name):
                continue
            if "North Arrow" in seen:
                continue
            seen.add("North Arrow")
            kept.append("North Arrow")
        return kept

    kept = []
    seen: set[str] = set()
    for name in raw:
        key = _norm_class_key(name)
        if name in foreign or key in foreign:
            continue
        if name in seen:
            continue
        seen.add(name)
        kept.append(name)
    return kept or list(defaults)


def _is_image(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_SUFFIXES


def extract_dataset_zip(zip_bytes: bytes, dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        zf.extractall(dest)
    children = [p for p in dest.iterdir() if p.name not in {".", "__MACOSX"}]
    if len(children) == 1 and children[0].is_dir():
        return children[0]
    return dest


def count_images(root: Path) -> int:
    return sum(1 for path in root.rglob("*") if path.is_file() and _is_image(path))


def _rel_label_for_image(image: Path, images_root: Path, labels_root: Path) -> Path:
    rel = image.relative_to(images_root).with_suffix(".txt")
    return labels_root / rel


def _collect_pairs(images_dir: Path, labels_dir: Path) -> list[tuple[Path, Path]]:
    pairs: list[tuple[Path, Path]] = []
    if not images_dir.is_dir():
        return pairs
    for image in sorted(images_dir.rglob("*")):
        if not image.is_file() or not _is_image(image):
            continue
        label = _rel_label_for_image(image, images_dir, labels_dir)
        if label.is_file():
            pairs.append((image, label))
    return pairs


def _copy_pair(image: Path, label: Path, dest_images: Path, dest_labels: Path, images_root: Path) -> None:
    rel = image.relative_to(images_root)
    dest_img = dest_images / rel
    dest_lbl = dest_labels / rel.with_suffix(".txt")
    dest_img.parent.mkdir(parents=True, exist_ok=True)
    dest_lbl.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(image, dest_img)
    shutil.copy2(label, dest_lbl)


def write_data_yaml(*, root: Path, names: list[str], train: str, val: str) -> Path:
    payload = {
        "path": str(root.resolve()),
        "train": train,
        "val": val,
        "names": {i: name for i, name in enumerate(names)},
    }
    path = root / "data.yaml"
    path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
    return path


def prepare_yolo_dataset(
    root: Path,
    class_names: list[str],
    *,
    val_fraction: float = 0.2,
    task: str = "segment",
) -> Path:
    """
    Normalise an extracted ZIP into Ultralytics YOLO layout and return data.yaml.

    Accepted layouts:
    - LabelMe JSON files (one per page, with imageData)
    - already has data.yaml
    - images/train + images/val (and labels/...)
    - images/ + labels/ (random split)
    - train/images + val/images
    """
    from app.yolo.convert_labelme import convert_labelme_dir, find_labelme_root

    labelme_root = find_labelme_root(root)
    if labelme_root is not None:
        out = root / "_from_labelme"
        if out.exists():
            shutil.rmtree(out)
        convert_labelme_dir(
            labelme_root,
            out,
            fold=None,
            class_names=class_names,
            val_fraction=val_fraction,
            task=task,
        )
        yaml_path = out / "data.yaml"
        if not yaml_path.is_file():
            raise ValueError("LabelMe conversion produced no data.yaml.")
        try:
            from app.config import get_settings
            from app.yolo.train_tiles import maybe_expand_data_yaml_with_tiles

            maybe_expand_data_yaml_with_tiles(yaml_path, settings=get_settings(), task=task)
        except Exception:
            # Tiling is best-effort; keep the untiled dataset if expansion fails.
            pass
        return yaml_path

    existing = root / "data.yaml"
    if existing.is_file():
        data = yaml.safe_load(existing.read_text(encoding="utf-8")) or {}
        data["path"] = str(root.resolve())
        if class_names and not data.get("names"):
            data["names"] = {i: name for i, name in enumerate(class_names)}
        existing.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
        return existing

    train_images = root / "images" / "train"
    val_images = root / "images" / "val"
    if train_images.is_dir() and val_images.is_dir():
        return write_data_yaml(
            root=root,
            names=class_names,
            train="images/train",
            val="images/val",
        )

    alt_train = root / "train" / "images"
    alt_val = root / "val" / "images"
    if alt_train.is_dir() and alt_val.is_dir():
        return write_data_yaml(
            root=root,
            names=class_names,
            train="train/images",
            val="val/images",
        )

    images_dir = root / "images"
    labels_dir = root / "labels"
    pairs = _collect_pairs(images_dir, labels_dir)
    if not pairs:
        # Flat: image.jpg next to image.txt
        pairs = []
        for image in sorted(root.glob("*")):
            if image.is_file() and _is_image(image):
                label = image.with_suffix(".txt")
                if label.is_file():
                    pairs.append((image, label))
        images_dir = root

    if not pairs:
        raise ValueError(
            "No labelled images found. Upload a LabelMe ZIP (one .json per page) "
            "or a YOLO ZIP with images/ + labels/ (and optional data.yaml)."
        )

    rng = random.Random(42)
    shuffled = list(pairs)
    rng.shuffle(shuffled)
    val_count = max(1, int(round(len(shuffled) * val_fraction))) if len(shuffled) >= 2 else 0
    val_pairs = shuffled[:val_count]
    train_pairs = shuffled[val_count:] or shuffled

    out = root / "_yolo"
    if out.exists():
        shutil.rmtree(out)
    train_img_dir = out / "images" / "train"
    val_img_dir = out / "images" / "val"
    train_lbl_dir = out / "labels" / "train"
    val_lbl_dir = out / "labels" / "val"

    for image, label in train_pairs:
        _copy_pair(image, label, train_img_dir, train_lbl_dir, images_dir)
    for image, label in (val_pairs or train_pairs[:1]):
        _copy_pair(image, label, val_img_dir, val_lbl_dir, images_dir)

    return write_data_yaml(
        root=out,
        names=class_names,
        train="images/train",
        val="images/val",
    )


RETINANET_BASE_ID = "retinanet_latest.pth"
FASTER_RCNN_BASE_ID = "faster_rcnn_latest.pth"
CASCADE_RCNN_BASE_ID = "cascade_swin_latest.pth"

_RETINANET_ALIASES = frozenset(
    {
        "retinanet",
        "retinanet.pt",
        "retinanet.pth",
        "retinanet_latest.pth",
        "wall:retinanet",
    }
)
_FASTER_ALIASES = frozenset(
    {
        "faster_rcnn",
        "faster-rcnn",
        "fasterrcnn",
        "faster_rcnn_latest.pth",
        "wall:faster_rcnn",
    }
)
_CASCADE_ALIASES = frozenset(
    {
        "cascade_swin",
        "cascade",
        "cascade_rcnn",
        "cascade-rcnn",
        "cascade_swin_latest.pth",
        "wall:cascade_swin",
    }
)


def is_retinanet_base(base_model: str) -> bool:
    name = (base_model or "").strip().lower().replace("\\", "/")
    leaf = name.rsplit("/", 1)[-1]
    return leaf in _RETINANET_ALIASES or name.endswith("/retinanet_latest.pth")


def is_faster_rcnn_base(base_model: str) -> bool:
    name = (base_model or "").strip().lower().replace("\\", "/")
    leaf = name.rsplit("/", 1)[-1]
    return leaf in _FASTER_ALIASES or name.endswith("/faster_rcnn_latest.pth")


def is_cascade_rcnn_base(base_model: str) -> bool:
    name = (base_model or "").strip().lower().replace("\\", "/")
    leaf = name.rsplit("/", 1)[-1]
    return leaf in _CASCADE_ALIASES or name.endswith("/cascade_swin_latest.pth")


def is_torchvision_detect_base(base_model: str) -> bool:
    return is_retinanet_base(base_model) or is_faster_rcnn_base(base_model) or is_cascade_rcnn_base(
        base_model
    )


def torchvision_detect_kind(base_model: str) -> str | None:
    if is_retinanet_base(base_model):
        return "retinanet"
    if is_faster_rcnn_base(base_model):
        return "faster_rcnn"
    if is_cascade_rcnn_base(base_model):
        return "cascade_swin"
    return None


DEEPLAB_BASE_ID = "deeplab_walls_best.h5"
UNET_BASE_ID = "unet_walls_best.h5"
MITUNET_BASE_ID = "mitunet_walls.pth"

_DEEPLAB_ALIASES = frozenset(
    {
        "deeplab",
        "deeplabv3",
        "deeplabv3+",
        "floordata",
        "wall:deeplab",
        "wall:floordata",
        "deeplab_walls_best.h5",
    }
)
_UNET_ALIASES = frozenset(
    {
        "unet",
        "unet_floordata",
        "wall:unet_floordata",
        "unet_walls_best.h5",
        "simple_walls_best.h5",
    }
)


def is_deeplab_base(base_model: str) -> bool:
    name = (base_model or "").strip().lower().replace("\\", "/")
    leaf = name.rsplit("/", 1)[-1]
    return leaf in _DEEPLAB_ALIASES or "deeplab" in leaf


def is_unet_floordata_base(base_model: str) -> bool:
    name = (base_model or "").strip().lower().replace("\\", "/")
    leaf = name.rsplit("/", 1)[-1]
    if leaf in _DEEPLAB_ALIASES:
        return False
    return leaf in _UNET_ALIASES or leaf.startswith("unet_walls") or leaf.startswith("simple_walls")


def is_mitunet_base(base_model: str) -> bool:
    from app.studio.mitunet_train import is_mitunet_base as _is_mitunet

    return _is_mitunet(base_model)


def is_floordata_base(base_model: str) -> bool:
    return is_deeplab_base(base_model) or is_unet_floordata_base(base_model)


def floordata_base_kind(base_model: str) -> str | None:
    if is_deeplab_base(base_model):
        return "deeplab"
    if is_unet_floordata_base(base_model):
        return "unet"
    return None


def default_base_model(task: str) -> str:
    if task == "segment":
        return "yolov8n-seg.pt"
    if task == "pose":
        return "yolo26n-pose.pt"
    return "yolov8n.pt"


YOLO_DETECT_BASES = [
    "yolov8n.pt",
    "yolov8s.pt",
    "yolov8m.pt",
    "yolov8l.pt",
    "yolov8x.pt",
    "yolo11n.pt",
    "yolo11s.pt",
    "yolo11m.pt",
    "yolo11l.pt",
    "yolo11x.pt",
]
YOLO_POSE_BASES = [
    "yolo26n-pose.pt",
    "yolo26s-pose.pt",
    "yolo26m-pose.pt",
    "yolo11n-pose.pt",
    "yolo11s-pose.pt",
    "yolov8n-pose.pt",
    "yolov8s-pose.pt",
]
YOLO_SEG_BASES = [
    "yolov8n-seg.pt",
    "yolov8s-seg.pt",
    "yolov8m-seg.pt",
    "yolov8l-seg.pt",
    "yolov8x-seg.pt",
    "yolo11n-seg.pt",
    "yolo11s-seg.pt",
    "yolo11m-seg.pt",
    "yolo11l-seg.pt",
    "yolo11x-seg.pt",
]


def list_base_models(task: str | None = None) -> list[dict]:
    """Catalog of fine-tune bases for Model Studio (task-filtered when provided)."""
    from app.studio.mitunet_train import mitunet_train_available
    from app.studio.model_catalog import (
        CATEGORY_NORTH_ARROW,
        CATEGORY_OBJECT_DETECT,
        CATEGORY_ROOM_TYPES,
        CATEGORY_WALL_SEGMENT,
        LAYOUT_BASE_ID,
        MITUNET_BASE_ID,
        ROOM_BASE_ID,
        WALL_YOLO_BASE_ID,
        pretrained_base_meta,
    )
    from app.yolo.mitunet import mitunet_ready

    mit_ok = mitunet_train_available() and mitunet_ready()

    items: list[dict] = []

    for extra_id in (LAYOUT_BASE_ID, ROOM_BASE_ID, WALL_YOLO_BASE_ID):
        meta = pretrained_base_meta(extra_id)
        if meta:
            items.append(meta)

    for mid in YOLO_DETECT_BASES:
        items.append(
            {
                "id": mid,
                "name": f"YOLO detect · {mid.replace('.pt', '')}",
                "task": "detect",
                "family": "yolo",
                "category": CATEGORY_OBJECT_DETECT,
                "categories": [CATEGORY_OBJECT_DETECT],
                "description": "Ultralytics COCO-pretrained detector.",
                "runnable": True,
                "ready": True,
            }
        )
    for mid in YOLO_POSE_BASES:
        items.append(
            {
                "id": mid,
                "name": f"YOLO pose · {mid.replace('.pt', '')}",
                "task": "pose",
                "family": "yolo",
                "category": CATEGORY_NORTH_ARROW,
                "categories": [CATEGORY_NORTH_ARROW],
                "description": "Ultralytics pose checkpoint — fine-tune tip/base for north heading.",
                "runnable": True,
                "ready": True,
            }
        )
    for mid in YOLO_SEG_BASES:
        items.append(
            {
                "id": mid,
                "name": f"YOLO segment · {mid.replace('.pt', '')}",
                "task": "segment",
                "family": "yolo",
                "category": CATEGORY_ROOM_TYPES,
                "description": "Ultralytics instance segmentation (room type masks).",
                "runnable": True,
                "ready": True,
            }
        )
    items.append(
        {
            "id": MITUNET_BASE_ID,
            "name": "MitUNet (Mix-Transformer B4 walls)",
            "task": "segment",
            "family": "mitunet",
            "category": CATEGORY_WALL_SEGMENT,
            "description": "The wall segmentation trainer — merges Wall / External Wall labels.",
            "runnable": mit_ok,
            "ready": mit_ok,
        }
    )
    if task in {"detect", "segment", "pose"}:
        return [item for item in items if item["task"] == task]
    return items


def is_pose_base(base_model: str) -> bool:
    leaf = (base_model or "").strip().lower().replace("\\", "/").rsplit("/", 1)[-1]
    return leaf.endswith("-pose.pt") or leaf in {name.lower() for name in YOLO_POSE_BASES}


def effective_train_task(dataset: dict, base_model: str = "") -> str:
    from app.studio.model_catalog import CATEGORY_NORTH_ARROW, normalize_category

    if is_pose_base(base_model):
        return "pose"
    if normalize_category(str(dataset.get("category") or "") or None) == CATEGORY_NORTH_ARROW:
        return "pose"
    return str(dataset.get("task") or "detect")


def assert_base_model(task: str, base_model: str) -> str:
    from app.studio.model_catalog import (
        LAYOUT_BASE_ID,
        ROOM_BASE_ID,
        WALL_YOLO_BASE_ID,
        is_layout_base,
        is_room_base,
        is_wall_yolo_base,
    )

    name = (base_model or "").strip() or default_base_model(task)
    if is_layout_base(name):
        if task == "segment":
            raise ValueError("Layout YOLO is a detect base. Use a *-seg.pt model for segmentation.")
        return LAYOUT_BASE_ID
    if is_wall_yolo_base(name):
        if task == "segment":
            raise ValueError("Wall OBB YOLO is a detect base. Use a segmentation model for masks.")
        return WALL_YOLO_BASE_ID
    if is_room_base(name):
        if task == "segment":
            raise ValueError("Room YOLO is a detect base. Use a *-seg.pt model for segmentation.")
        return ROOM_BASE_ID
    if is_retinanet_base(name):
        if task == "segment":
            raise ValueError("RetinaNet is a detect base. Use a *-seg.pt or floorData model for segmentation.")
        return RETINANET_BASE_ID
    if is_faster_rcnn_base(name):
        if task == "segment":
            raise ValueError("Faster R-CNN is a detect base. Use a *-seg.pt or floorData model for segmentation.")
        return FASTER_RCNN_BASE_ID
    if is_cascade_rcnn_base(name):
        if task == "segment":
            raise ValueError("Cascade R-CNN is a detect base. Use a *-seg.pt or floorData model for segmentation.")
        return CASCADE_RCNN_BASE_ID
    if is_deeplab_base(name):
        if task == "detect":
            raise ValueError("DeepLab is a segmentation base. Use a YOLO detect or MMDet base for detection.")
        from app.studio.floordata_train import tensorflow_available
        from app.studio.tf_runtime import tensorflow_runtime_hint

        if not tensorflow_available():
            raise ValueError("floorData DeepLab needs TensorFlow. " + tensorflow_runtime_hint())
        return DEEPLAB_BASE_ID
    if is_unet_floordata_base(name):
        if task == "detect":
            raise ValueError("UNet is a segmentation base. Use a YOLO detect or MMDet base for detection.")
        from app.studio.floordata_train import tensorflow_available
        from app.studio.tf_runtime import tensorflow_runtime_hint

        if not tensorflow_available():
            raise ValueError("floorData UNet needs TensorFlow. " + tensorflow_runtime_hint())
        return UNET_BASE_ID
    if is_mitunet_base(name):
        if task == "detect":
            raise ValueError("MitUNet is a wall segmentation base. Use a YOLO detect or MMDet base for detection.")
        from app.studio.mitunet_train import mitunet_train_available

        if not mitunet_train_available():
            raise ValueError(
                "MitUNet fine-tuning needs PyTorch and segmentation-models-pytorch in the inference environment."
            )
        return MITUNET_BASE_ID
    lowered = name.lower()
    if is_pose_base(name) or "pose" in lowered:
        if task != "pose":
            raise ValueError("Pose checkpoints (e.g. yolo26n-pose.pt) are for north-arrow tip/base training.")
        return name if name.endswith(".pt") else name
    if task == "pose":
        raise ValueError("North-arrow pose training needs a *-pose.pt base (e.g. yolo26n-pose.pt).")
    if task == "segment" and "seg" not in lowered:
        raise ValueError("Segmentation training needs a *-seg.pt base model (e.g. yolov8n-seg.pt).")
    if task == "detect" and ("seg" in lowered or "pose" in lowered):
        raise ValueError("Object detection training needs a detect checkpoint (e.g. yolov8n.pt), not *-seg.pt.")
    return name


def resolve_yolo_checkpoint(base_model: str) -> str:
    """Map catalog base id to a local path or URL for Ultralytics training."""
    from app.studio.model_catalog import (
        LAYOUT_BASE_ID,
        ROOM_BASE_ID,
        WALL_YOLO_BASE_ID,
        is_layout_base,
        is_room_base,
        is_wall_yolo_base,
        resolve_pretrained_yolo_weights,
    )

    if is_layout_base(base_model):
        return resolve_pretrained_yolo_weights(LAYOUT_BASE_ID)
    if is_wall_yolo_base(base_model):
        return resolve_pretrained_yolo_weights(WALL_YOLO_BASE_ID)
    if is_room_base(base_model):
        return resolve_pretrained_yolo_weights(ROOM_BASE_ID)
    return base_model
