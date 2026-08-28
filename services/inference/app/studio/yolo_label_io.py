"""YOLO label / data.yaml helpers without torch (usable from the TensorFlow venv)."""

from __future__ import annotations

from pathlib import Path


def parse_yolo_label_line(line: str, width: int, height: int) -> tuple[int, list[float]] | None:
    parts = line.strip().split()
    if len(parts) < 5:
        return None
    try:
        cls = int(float(parts[0]))
        nums = [float(x) for x in parts[1:]]
    except ValueError:
        return None
    if len(nums) == 4:
        cx, cy, bw, bh = nums
        x1 = (cx - bw / 2) * width
        y1 = (cy - bh / 2) * height
        x2 = (cx + bw / 2) * width
        y2 = (cy + bh / 2) * height
    else:
        xs = [nums[i] * width for i in range(0, len(nums) - 1, 2)]
        ys = [nums[i] * height for i in range(1, len(nums), 2)]
        if not xs or not ys:
            return None
        x1, x2 = min(xs), max(xs)
        y1, y2 = min(ys), max(ys)
    if x2 <= x1 or y2 <= y1:
        return None
    return cls, [x1, y1, x2, y2]


def load_yolo_boxes(label_path: Path, width: int, height: int) -> tuple[list[list[float]], list[int]]:
    boxes: list[list[float]] = []
    labels: list[int] = []
    if not label_path.is_file():
        return boxes, labels
    for line in label_path.read_text(encoding="utf-8").splitlines():
        parsed = parse_yolo_label_line(line, width, height)
        if parsed is None:
            continue
        cls, box = parsed
        boxes.append(box)
        labels.append(cls)
    return boxes, labels


def split_from_yaml(data_yaml: Path, split: str) -> tuple[list[Path], list[Path]]:
    import yaml

    data = yaml.safe_load(data_yaml.read_text(encoding="utf-8")) or {}
    root = Path(str(data.get("path") or data_yaml.parent))
    rel = data.get(split) or data.get("train")
    img_dir = root / str(rel)
    if not img_dir.is_dir():
        return [], []
    images = sorted(
        [p for p in img_dir.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}]
    )
    labels: list[Path] = []
    for image in images:
        rel_img = image.relative_to(root)
        parts = list(rel_img.parts)
        if parts and parts[0] == "images":
            parts[0] = "labels"
        label = (root / Path(*parts)).with_suffix(".txt")
        labels.append(label)
    return images, labels
