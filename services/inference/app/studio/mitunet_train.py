"""Fine-tune MitUNet (Mix-Transformer B4 + U-Net + scSE) on Studio YOLO wall labels."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from app.studio.yolo_label_io import split_from_yaml
from app.yolo.mitunet import (
    IMAGENET_MEAN,
    IMAGENET_STD,
    _build_model,
    _unwrap_state_dict,
    ensure_mitunet_weights,
    mask_to_polygons,
)

STUDIO_MITUNET = "pytorch-mitunet"
META_SIDECAR = "studio_meta.json"
MITUNET_BASE_ID = "mitunet_walls.pth"

_WALL_LABELS = frozenset({"wall", "external wall", "external_wall"})


def mitunet_train_available() -> bool:
    try:
        import torch  # noqa: F401
        import segmentation_models_pytorch  # noqa: F401

        return True
    except ImportError:
        return False


def is_mitunet_base(base_model: str) -> bool:
    name = (base_model or "").strip().lower().replace("\\", "/")
    leaf = name.rsplit("/", 1)[-1]
    return leaf in {
        MITUNET_BASE_ID,
        "mitunet",
        "mitunet-mit-b4-walls",
        "wall:mitunet",
    } or "mitunet" in leaf and leaf.endswith(".pth")


def is_studio_mitunet_checkpoint(path: Path) -> bool:
    if not path.is_file() or path.suffix.lower() != ".pth":
        return False
    meta = path.with_name(META_SIDECAR)
    if meta.is_file():
        try:
            payload = json.loads(meta.read_text(encoding="utf-8"))
            return payload.get("studio_framework") == STUDIO_MITUNET
        except (OSError, json.JSONDecodeError):
            return False
    return False


def wall_class_indices(class_names: list[str]) -> set[int]:
    indices = {
        i
        for i, name in enumerate(class_names)
        if name.strip().lower().replace("_", " ") in _WALL_LABELS
    }
    if indices:
        return indices
    return set(range(len(class_names)))


def _yolo_to_binary_mask(
    label_path: Path,
    *,
    width: int,
    height: int,
    class_indices: set[int],
    out_size: int,
) -> np.ndarray:
    layer = Image.new("L", (out_size, out_size), 0)
    draw = ImageDraw.Draw(layer)
    if not label_path.is_file():
        return np.zeros((out_size, out_size), dtype=np.float32)

    scale_x = out_size / float(width or 1)
    scale_y = out_size / float(height or 1)
    for line in label_path.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split()
        if len(parts) < 5:
            continue
        try:
            cls = int(float(parts[0]))
            nums = [float(x) for x in parts[1:]]
        except ValueError:
            continue
        if cls not in class_indices:
            continue
        if len(nums) == 4:
            cx, cy, bw, bh = nums
            x1 = (cx - bw / 2) * width * scale_x
            y1 = (cy - bh / 2) * height * scale_y
            x2 = (cx + bw / 2) * width * scale_x
            y2 = (cy + bh / 2) * height * scale_y
            draw.rectangle([x1, y1, x2, y2], fill=255)
        else:
            pts: list[float] = []
            for i in range(0, len(nums) - 1, 2):
                pts.append(nums[i] * width * scale_x)
                pts.append(nums[i + 1] * height * scale_y)
            if len(pts) >= 6:
                draw.polygon(pts, fill=255)
    return np.asarray(layer, dtype=np.float32) / 255.0


def _load_pairs(
    data_yaml: Path,
    imgsz: int,
    class_indices: set[int],
) -> tuple[list[Path], list[np.ndarray], list[np.ndarray]]:
    images, labels = split_from_yaml(data_yaml, "train")
    if not images:
        raise ValueError("No training images found for MitUNet fine-tune.")
    xs: list[np.ndarray] = []
    ys: list[np.ndarray] = []
    for image_path, label_path in zip(images, labels, strict=False):
        with Image.open(image_path) as raw:
            w0, h0 = raw.size
        image = Image.open(image_path).convert("RGB").resize((imgsz, imgsz), Image.BILINEAR)
        arr = np.asarray(image, dtype=np.float32) / 255.0
        arr = (arr - IMAGENET_MEAN) / IMAGENET_STD
        mask = _yolo_to_mask_binary(label_path, w0, h0, class_indices, imgsz)
        xs.append(np.transpose(arr, (2, 0, 1)))
        ys.append(mask)
    return images, np.stack(xs), np.stack(ys)


def _yolo_to_mask_binary(
    label_path: Path,
    width: int,
    height: int,
    class_indices: set[int],
    out_size: int,
) -> np.ndarray:
    return _yolo_to_binary_mask(
        label_path,
        width=width,
        height=height,
        class_indices=class_indices,
        out_size=out_size,
    )


def load_mitunet_model(weights_path: Path, *, device: str = "cpu"):
    import torch

    model = _build_model()
    raw = torch.load(weights_path, map_location="cpu", weights_only=False)
    model.load_state_dict(_unwrap_state_dict(raw))
    model.to(device)
    return model


def _dice_loss(probs, targets, eps: float = 1e-6):
    import torch

    probs = probs.reshape(probs.size(0), -1)
    targets = targets.reshape(targets.size(0), -1)
    inter = (probs * targets).sum(dim=1)
    denom = probs.sum(dim=1) + targets.sum(dim=1)
    return 1.0 - ((2.0 * inter + eps) / (denom + eps)).mean()


def train_mitunet(
    *,
    data_yaml: Path,
    weights_out: Path,
    pretrained_path: Path | None,
    class_names: list[str],
    epochs: int,
    imgsz: int,
    batch: int,
    device: str,
    project: Path,
    name: str,
    on_epoch=None,
    preview_path: Path | None = None,
) -> Path:
    import torch
    from torch.utils.data import DataLoader, TensorDataset

    if not mitunet_train_available():
        raise RuntimeError(
            "MitUNet fine-tuning needs PyTorch and segmentation-models-pytorch in this environment."
        )

    torch_device = torch.device("cuda" if device == "cuda" and torch.cuda.is_available() else "cpu")
    size = max(64, (int(imgsz) // 32) * 32)
    class_indices = wall_class_indices(class_names)
    train_images, x_train, y_train = _load_pairs(data_yaml, size, class_indices)
    if x_train.shape[0] == 0:
        raise ValueError("MitUNet fine-tune: no training samples.")

    model = _build_model()
    warm_path = pretrained_path
    if warm_path is None or not warm_path.is_file():
        warm_path = ensure_mitunet_weights()
    raw = torch.load(warm_path, map_location="cpu", weights_only=False)
    model.load_state_dict(_unwrap_state_dict(raw))
    model.to(torch_device)

    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=1e-4, weight_decay=1e-4)
    bce = torch.nn.BCEWithLogitsLoss()

    dataset = TensorDataset(
        torch.from_numpy(x_train).float(),
        torch.from_numpy(y_train).float().unsqueeze(1),
    )
    loader = DataLoader(dataset, batch_size=max(1, batch), shuffle=True)

    run_dir = project / name
    run_dir.mkdir(parents=True, exist_ok=True)
    csv_path = run_dir / "results.csv"
    best_loss = float("inf")
    sample = train_images[0]
    last_path = run_dir / "last.pth"

    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["epoch", "train/loss", "train/dice"])

        for epoch in range(1, max(1, epochs) + 1):
            model.train()
            running = 0.0
            steps = 0
            for images, masks in loader:
                images = images.to(torch_device)
                masks = masks.to(torch_device)
                optimizer.zero_grad(set_to_none=True)
                logits = model(images)
                probs = torch.sigmoid(logits)
                loss = bce(logits, masks) + _dice_loss(probs, masks)
                loss.backward()
                optimizer.step()
                running += float(loss.detach().cpu())
                steps += 1

            mean_loss = running / max(1, steps)
            dice_score = max(0.0, 1.0 - mean_loss)
            writer.writerow([epoch, f"{mean_loss:.6f}", f"{dice_score:.6f}"])
            handle.flush()

            state = {k: v.detach().cpu() for k, v in model.state_dict().items()}
            torch.save(state, last_path)
            if mean_loss <= best_loss:
                best_loss = mean_loss
                weights_out.parent.mkdir(parents=True, exist_ok=True)
                torch.save(state, weights_out)
                meta = {
                    "studio_framework": STUDIO_MITUNET,
                    "class_names": list(class_names),
                    "imgsz": size,
                    "wall_class_indices": sorted(class_indices),
                    "threshold": 0.5,
                }
                weights_out.with_name(META_SIDECAR).write_text(
                    json.dumps(meta, indent=2),
                    encoding="utf-8",
                )
                last_path.with_name(META_SIDECAR).write_text(
                    json.dumps(meta, indent=2),
                    encoding="utf-8",
                )

            if on_epoch is not None:
                preview_ok = False
                if preview_path is not None:
                    preview_ok = write_mitunet_preview(model, sample, preview_path, imgsz=size)
                on_epoch(
                    epoch,
                    epochs,
                    metrics={"train/loss": mean_loss, "train/dice": dice_score},
                    last_weights=last_path if last_path.is_file() else None,
                    sample=sample,
                    preview_ok=preview_ok,
                )

    if not weights_out.is_file():
        raise FileNotFoundError("MitUNet training finished but no weights were saved.")
    return weights_out


def predict_mask_rgb(model, rgb: np.ndarray, *, imgsz: int, device: str) -> np.ndarray:
    """Float mask H×W in [0, 1] for an RGB uint8 image."""
    import torch

    from app.yolo.letterbox import letterbox_rgb, unletterbox_mask

    size = max(32, int(imgsz))
    canvas, scale, ox, oy, orig_hw = letterbox_rgb(rgb, size, fill=255, center=True)
    array = canvas.astype(np.float32) / 255.0
    array = (array - IMAGENET_MEAN) / IMAGENET_STD
    tensor = torch.from_numpy(np.transpose(array, (2, 0, 1))).unsqueeze(0).float()
    tensor = tensor.to(device)
    model.eval()
    with torch.inference_mode():
        logits = model(tensor)
        probs = torch.sigmoid(logits)[0, 0].detach().cpu().numpy()
    if probs.shape[0] != size or probs.shape[1] != size:
        probs = np.asarray(
            Image.fromarray(probs.astype(np.float32), mode="F").resize((size, size), Image.BILINEAR),
            dtype=np.float32,
        )
    return unletterbox_mask(
        probs,
        scale=scale,
        offset_x=ox,
        offset_y=oy,
        orig_hw=orig_hw,
        canvas_size=size,
    )


def write_mitunet_preview(model, sample: Path, out_path: Path, *, imgsz: int = 512) -> bool:
    try:
        if not sample.is_file():
            return False
        rgb = np.asarray(Image.open(sample).convert("RGB"), dtype=np.uint8)
        device = next(model.parameters()).device
        probs = predict_mask_rgb(model, rgb, imgsz=imgsz, device=str(device))
        binary = probs >= 0.5
        overlay = Image.fromarray(rgb).convert("RGBA")
        tint = Image.new("RGBA", overlay.size, (220, 38, 38, 90))
        tint.putalpha(Image.fromarray((binary.astype(np.uint8) * 255), mode="L"))
        overlay = Image.alpha_composite(overlay, tint)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        overlay.convert("RGB").save(out_path, format="PNG")
        return out_path.is_file()
    except Exception:
        return False


def write_mitunet_preview_from_weights(
    weights_path: Path,
    sample: Path,
    out_path: Path,
    *,
    imgsz: int = 512,
    device: str = "cpu",
) -> bool:
    try:
        model = load_mitunet_model(weights_path, device=device)
        return write_mitunet_preview(model, sample, out_path, imgsz=imgsz)
    except Exception:
        return False


def detect_studio_mitunet(
    rgb: np.ndarray,
    *,
    weights_path: Path,
    conf: float = 0.25,
    imgsz: int = 512,
    device: str = "cpu",
):
    from uuid import uuid4

    from app.yolo.predict import DetectedRegion

    model = load_mitunet_model(weights_path, device=device)
    probs = predict_mask_rgb(model, rgb, imgsz=imgsz, device=device)
    threshold = float(conf)
    binary = probs >= threshold
    if not np.any(binary):
        return [], ["wall"]
    confidence = float(np.clip(probs[binary].mean(), 0.0, 1.0))
    min_area = max(16, int(0.0002 * rgb.shape[0] * rgb.shape[1]))
    polygons = mask_to_polygons(binary.astype(np.uint8), min_area=min_area, max_vertices=80)
    regions: list[DetectedRegion] = []
    for poly in polygons:
        if poly.shape[0] < 3:
            continue
        xs = poly[:, 0]
        ys = poly[:, 1]
        x1, y1, x2, y2 = float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())
        regions.append(
            DetectedRegion(
                id=str(uuid4()),
                type="wall",
                label="Wall",
                confidence=round(confidence, 4),
                polygon=[(float(x), float(y)) for x, y in poly],
                bbox=(x1, y1, x2 - x1, y2 - y1),
                attributes={"roomType": "wall", "label": "Wall", "source": "studio-mitunet"},
            )
        )
    return regions, ["wall"]
