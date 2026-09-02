"""Training-monitor artifacts: epoch previews, GT overlay, Ultralytics plots."""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from PIL import Image, ImageDraw

from app.studio.local_store import job_artifacts_dir

PREVIEW_KEEP = 24
_EPOCH_NAME = re.compile(r"^ep_(\d+)\.png$", re.IGNORECASE)

PLOT_CATALOG: tuple[tuple[str, str], ...] = (
    ("results.png", "Training curves"),
    ("confusion_matrix.png", "Confusion matrix"),
    ("confusion_matrix_normalized.png", "Confusion (normalized)"),
    ("val_batch0_labels.jpg", "Val labels"),
    ("val_batch0_pred.jpg", "Val predictions"),
    ("val_batch1_labels.jpg", "Val labels 2"),
    ("val_batch1_pred.jpg", "Val predictions 2"),
    ("labels.jpg", "Label distribution"),
    ("train_batch0.jpg", "Train batch"),
)

_PLOT_ALLOWED = {name for name, _label in PLOT_CATALOG}
_SAFE_PLOT = re.compile(r"^[A-Za-z0-9._-]+$")

_COLORS = (
    (220, 38, 38),
    (37, 99, 235),
    (22, 163, 74),
    (217, 119, 6),
    (147, 51, 234),
    (8, 145, 178),
)


def previews_dir(artifacts: Path) -> Path:
    path = artifacts / "previews"
    path.mkdir(parents=True, exist_ok=True)
    return path


def list_preview_epochs(artifacts: Path) -> list[int]:
    folder = artifacts / "previews"
    if not folder.is_dir():
        return []
    epochs: list[int] = []
    for path in folder.glob("ep_*.png"):
        match = _EPOCH_NAME.match(path.name)
        if match:
            epochs.append(int(match.group(1)))
    return sorted(set(epochs))


def prune_epoch_previews(folder: Path, keep: int = PREVIEW_KEEP) -> None:
    files = sorted(
        (path for path in folder.glob("ep_*.png") if _EPOCH_NAME.match(path.name)),
        key=lambda path: int(_EPOCH_NAME.match(path.name).group(1)),  # type: ignore[union-attr]
    )
    extra = len(files) - keep
    if extra <= 0:
        return
    for path in files[:extra]:
        path.unlink(missing_ok=True)


def record_epoch_preview(preview_path: Path, epoch: int) -> list[int]:
    """Copy the latest overlay to previews/ep_NNN.png and prune old snapshots."""
    artifacts = preview_path.parent
    if not preview_path.is_file():
        return list_preview_epochs(artifacts)
    dest = previews_dir(artifacts) / f"ep_{int(epoch):03d}.png"
    shutil.copy2(preview_path, dest)
    prune_epoch_previews(dest.parent)
    return list_preview_epochs(artifacts)


def resolve_epoch_preview(artifacts: Path, epoch: int | None) -> Path | None:
    latest = artifacts / "preview.png"
    if epoch is None:
        return latest if latest.is_file() else None
    exact = artifacts / "previews" / f"ep_{int(epoch):03d}.png"
    if exact.is_file():
        return exact
    available = list_preview_epochs(artifacts)
    if not available:
        return latest if latest.is_file() else None
    nearest = min(available, key=lambda value: abs(value - int(epoch)))
    return artifacts / "previews" / f"ep_{nearest:03d}.png"


def label_path_for_image(image: Path) -> Path | None:
    parts = list(image.parts)
    if "images" in parts:
        index = parts.index("images")
        candidate = Path(*parts[:index]) / "labels" / Path(*parts[index + 1 :]).with_suffix(".txt")
        if candidate.is_file():
            return candidate
    sidecar = image.with_suffix(".txt")
    return sidecar if sidecar.is_file() else None


def write_gt_overlay(sample: Path, out_path: Path) -> bool:
    """Draw YOLO box / polygon labels on the sample page."""
    if not sample.is_file():
        return False
    image = Image.open(sample).convert("RGB")
    overlay = image.convert("RGBA")
    draw = ImageDraw.Draw(overlay, "RGBA")
    width, height = overlay.size
    label = label_path_for_image(sample)
    if label is not None and label.is_file():
        for line in label.read_text(encoding="utf-8").splitlines():
            parts = line.split()
            if len(parts) < 5:
                continue
            try:
                cls = int(float(parts[0]))
                nums = [float(value) for value in parts[1:]]
            except ValueError:
                continue
            color = _COLORS[cls % len(_COLORS)]
            stroke = max(2, min(width, height) // 280)
            if len(nums) == 4:
                cx, cy, box_w, box_h = nums
                x1 = (cx - box_w / 2) * width
                y1 = (cy - box_h / 2) * height
                x2 = (cx + box_w / 2) * width
                y2 = (cy + box_h / 2) * height
                draw.rectangle([x1, y1, x2, y2], outline=(*color, 255), width=stroke)
            elif len(nums) >= 6 and len(nums) % 2 == 0:
                points = [(nums[i] * width, nums[i + 1] * height) for i in range(0, len(nums), 2)]
                if len(points) >= 3:
                    draw.polygon(points, outline=(*color, 255), fill=(*color, 48))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    overlay.convert("RGB").save(out_path, format="PNG")
    return out_path.is_file()


def find_plot(artifacts: Path, name: str) -> Path | None:
    if name not in _PLOT_ALLOWED or not _SAFE_PLOT.match(name):
        return None
    runs = artifacts / "runs"
    if not runs.is_dir():
        return None
    matches = sorted(runs.rglob(name))
    return matches[0] if matches else None


def list_training_plots(artifacts: Path) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for name, label in PLOT_CATALOG:
        if find_plot(artifacts, name) is not None:
            items.append({"id": name, "label": label})
    return items


def monitor_payload(job_id: str) -> dict:
    artifacts = job_artifacts_dir(job_id)
    gt = artifacts / "previews" / "gt.png"
    return {
        "preview_epochs": list_preview_epochs(artifacts),
        "has_gt_preview": gt.is_file(),
        "plots": list_training_plots(artifacts),
    }
