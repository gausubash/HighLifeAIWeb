"""Fine-tune the Cubicasa RetinaNet checkpoint on a YOLO-format Studio dataset."""

from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageDraw
from torch.utils.data import DataLoader, Dataset
from torchvision.transforms.functional import to_tensor

from app.studio.yolo_label_io import load_yolo_boxes, parse_yolo_label_line, split_from_yaml

# Back-compat aliases used by older callers / tests.
_parse_yolo_label_line = parse_yolo_label_line
_split_from_yaml = split_from_yaml

STUDIO_RETINANET_FRAMEWORK = "torchvision-retinanet"
STUDIO_FASTER_FRAMEWORK = "torchvision-faster-rcnn"
STUDIO_CASCADE_FRAMEWORK = "torchvision-cascade-rcnn"

_FRAMEWORK_BY_KIND = {
    "retinanet": STUDIO_RETINANET_FRAMEWORK,
    "faster_rcnn": STUDIO_FASTER_FRAMEWORK,
    "cascade_swin": STUDIO_CASCADE_FRAMEWORK,
}


def is_studio_retinanet_checkpoint(path: Path) -> bool:
    return _studio_framework(path) == STUDIO_RETINANET_FRAMEWORK


def is_studio_torchvision_detect_checkpoint(path: Path) -> bool:
    return _studio_framework(path) in {
        STUDIO_RETINANET_FRAMEWORK,
        STUDIO_FASTER_FRAMEWORK,
        STUDIO_CASCADE_FRAMEWORK,
    }


def _studio_framework(path: Path) -> str | None:
    if not path.is_file():
        return None
    try:
        obj = torch.load(path, map_location="cpu", weights_only=False)
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    fw = obj.get("studio_framework")
    return str(fw) if fw else None


class _YoloBoxDataset(Dataset):
    def __init__(self, images: list[Path], labels: list[Path], imgsz: int):
        self.images = images
        self.labels = labels
        self.imgsz = imgsz

    def __len__(self) -> int:
        return len(self.images)

    def __getitem__(self, index: int):
        image_path = self.images[index]
        image = Image.open(image_path).convert("RGB")
        w0, h0 = image.size
        boxes, labels = load_yolo_boxes(self.labels[index], w0, h0)
        scale = 1.0
        if max(w0, h0) > self.imgsz:
            scale = self.imgsz / float(max(w0, h0))
            image = image.resize((max(1, int(w0 * scale)), max(1, int(h0 * scale))), Image.BILINEAR)
        if scale != 1.0:
            boxes = [[v * scale for v in box] for box in boxes]
        target = {
            "boxes": torch.tensor(boxes, dtype=torch.float32).reshape(-1, 4),
            "labels": torch.tensor(labels, dtype=torch.int64),
        }
        return to_tensor(image), target, str(image_path)


def _collate(batch):
    images, targets, paths = zip(*batch, strict=False)
    return list(images), list(targets), list(paths)


def _mean_loss(loss_dict: dict) -> torch.Tensor:
    values = [value for value in loss_dict.values() if torch.is_tensor(value)]
    if not values:
        return torch.tensor(0.0)
    return torch.stack([v if v.ndim == 0 else v.mean() for v in values]).sum()


def _write_preview(
    model,
    image_path: Path,
    out_path: Path,
    class_names: list[str],
    device,
    *,
    label_offset: int = 0,
) -> bool:
    try:
        image = Image.open(image_path).convert("RGB")
        tensor = to_tensor(image).to(device)
        model.eval()
        with torch.inference_mode():
            out = model([tensor])[0]
        draw = ImageDraw.Draw(image)
        boxes = out["boxes"].detach().cpu().numpy()
        scores = out["scores"].detach().cpu().numpy()
        labels = out["labels"].detach().cpu().numpy()
        for box, score, label in zip(boxes, scores, labels, strict=False):
            if float(score) < 0.2:
                continue
            x1, y1, x2, y2 = [float(v) for v in box]
            idx = int(label) - int(label_offset)
            name = class_names[idx] if 0 <= idx < len(class_names) else str(int(label))
            draw.rectangle([x1, y1, x2, y2], outline=(220, 38, 38), width=2)
            draw.text((x1 + 2, y1 + 2), f"{name} {float(score):.2f}", fill=(220, 38, 38))
        out_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(out_path, format="PNG")
        return True
    except Exception:
        return False


def write_retinanet_preview(model, image_path: Path, out_path: Path, class_names: list[str], device) -> bool:
    return _write_preview(model, image_path, out_path, class_names, device)


def _build_studio_detector(kind: str, *, num_classes: int, mmdet_state):
    from app.yolo.mmdet_wall import build_torchvision_faster_rcnn, build_torchvision_retinanet

    if kind == "retinanet":
        return build_torchvision_retinanet(num_classes=num_classes, mmdet_state=mmdet_state)
    if kind in {"faster_rcnn", "cascade_swin"}:
        return build_torchvision_faster_rcnn(
            num_classes=num_classes,
            mmdet_state=mmdet_state,
            cascade=kind == "cascade_swin",
        )
    raise ValueError(f"Unknown torchvision detect kind: {kind}")


def train_torchvision_detector(
    *,
    kind: str,
    data_yaml: Path,
    weights_out: Path,
    pretrained_path: Path,
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
    from app.yolo.mmdet_wall import _load_checkpoint, _strip_prefix

    kind = (kind or "retinanet").strip().lower()
    if kind not in _FRAMEWORK_BY_KIND:
        raise ValueError(f"Unsupported detector kind: {kind}")
    if not pretrained_path.is_file():
        raise FileNotFoundError(
            f"{kind} base weights not found at {pretrained_path}. "
            f"Download the .pth into services/inference/models/."
        )

    train_images, train_labels = _split_from_yaml(data_yaml, "train")
    val_images, val_labels = _split_from_yaml(data_yaml, "val")
    if not train_images:
        raise ValueError(f"No training images found for {kind} fine-tune.")

    ckpt = _load_checkpoint(pretrained_path)
    mmdet_state = _strip_prefix(ckpt.get("state_dict") or {})
    torch_device = torch.device("cuda" if device == "cuda" and torch.cuda.is_available() else "cpu")
    model = _build_studio_detector(kind, num_classes=len(class_names), mmdet_state=mmdet_state)
    model.to(torch_device)
    model.train()

    # Faster/Cascade use 1-indexed labels (0 = background). RetinaNet uses 0-indexed.
    label_offset = 0 if kind == "retinanet" else 1

    class _OffsetDataset(_YoloBoxDataset):
        def __getitem__(self, index: int):
            image, target, path = super().__getitem__(index)
            if label_offset and target["labels"].numel():
                target = {**target, "labels": target["labels"] + label_offset}
            return image, target, path

    loader = DataLoader(
        _OffsetDataset(train_images, train_labels, imgsz),
        batch_size=max(1, batch),
        shuffle=True,
        collate_fn=_collate,
        num_workers=0,
    )
    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=1e-4, weight_decay=1e-4)

    run_dir = project / name
    run_dir.mkdir(parents=True, exist_ok=True)
    csv_path = run_dir / "results.csv"
    best_loss = float("inf")
    sample = val_images[0] if val_images else train_images[0]
    framework = _FRAMEWORK_BY_KIND[kind]

    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["epoch", "train/loss"])

        for epoch in range(1, max(1, epochs) + 1):
            model.train()
            running = 0.0
            steps = 0
            for images, targets, _paths in loader:
                images = [image.to(torch_device) for image in images]
                targets = [{k: v.to(torch_device) for k, v in t.items()} for t in targets]
                loss_dict = model(images, targets)
                loss = _mean_loss(loss_dict)
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                running += float(loss.detach().cpu())
                steps += 1
            mean_loss = running / max(1, steps)
            writer.writerow([epoch, f"{mean_loss:.6f}"])
            handle.flush()

            payload = {
                "studio_framework": framework,
                "studio_kind": kind,
                "label_offset": label_offset,
                "class_names": list(class_names),
                "state_dict": {k: v.detach().cpu() for k, v in model.state_dict().items()},
            }
            last_path = run_dir / "last.pt"
            torch.save(payload, last_path)
            if mean_loss <= best_loss:
                best_loss = mean_loss
                torch.save(payload, weights_out)

            if on_epoch is not None:
                preview_ok = False
                if preview_path is not None:
                    preview_ok = _write_preview(
                        model,
                        Path(sample),
                        preview_path,
                        class_names,
                        torch_device,
                        label_offset=label_offset,
                    )
                    model.train()
                on_epoch(
                    epoch,
                    epochs,
                    metrics={"train/loss": mean_loss},
                    last_weights=last_path if last_path.is_file() else None,
                    sample=sample,
                    preview_ok=preview_ok,
                )

    if not weights_out.is_file():
        raise FileNotFoundError(f"{kind} training finished but no weights were saved.")
    return weights_out


def train_retinanet(
    *,
    data_yaml: Path,
    weights_out: Path,
    pretrained_path: Path,
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
    return train_torchvision_detector(
        kind="retinanet",
        data_yaml=data_yaml,
        weights_out=weights_out,
        pretrained_path=pretrained_path,
        class_names=class_names,
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        device=device,
        project=project,
        name=name,
        on_epoch=on_epoch,
        preview_path=preview_path,
    )


def load_studio_retinanet(path: Path, device: str = "cpu"):
    model, class_names, torch_device, _kind, _offset = load_studio_torchvision_detector(path, device=device)
    return model, class_names, torch_device


def load_studio_torchvision_detector(path: Path, device: str = "cpu"):
    obj = torch.load(path, map_location="cpu", weights_only=False)
    if not isinstance(obj, dict):
        raise ValueError(f"{path} is not a Studio detector checkpoint.")
    framework = obj.get("studio_framework")
    kind = str(obj.get("studio_kind") or "")
    if not kind:
        if framework == STUDIO_RETINANET_FRAMEWORK:
            kind = "retinanet"
        elif framework == STUDIO_FASTER_FRAMEWORK:
            kind = "faster_rcnn"
        elif framework == STUDIO_CASCADE_FRAMEWORK:
            kind = "cascade_swin"
        else:
            raise ValueError(f"{path} is not a Studio torchvision detect checkpoint.")
    class_names = [str(name) for name in (obj.get("class_names") or [])]
    if not class_names:
        raise ValueError("Studio detector checkpoint has no class names.")
    model = _build_studio_detector(kind, num_classes=len(class_names), mmdet_state=None)
    model.load_state_dict(obj["state_dict"], strict=False)
    torch_device = torch.device("cuda" if device == "cuda" and torch.cuda.is_available() else "cpu")
    model.to(torch_device)
    model.eval()
    label_offset = int(obj.get("label_offset") or (0 if kind == "retinanet" else 1))
    return model, class_names, torch_device, kind, label_offset


def detect_studio_retinanet(
    rgb: np.ndarray,
    *,
    weights_path: Path,
    conf: float = 0.25,
    imgsz: int = 896,
    device: str = "cpu",
):
    return detect_studio_torchvision_detector(
        rgb,
        weights_path=weights_path,
        conf=conf,
        imgsz=imgsz,
        device=device,
    )


def detect_studio_torchvision_detector(
    rgb: np.ndarray,
    *,
    weights_path: Path,
    conf: float = 0.25,
    imgsz: int = 896,
    device: str = "cpu",
):
    from app.yolo.predict import DetectedRegion

    from uuid import uuid4

    model, class_names, torch_device, kind, label_offset = load_studio_torchvision_detector(
        weights_path, device=device
    )
    image = Image.fromarray(rgb.astype(np.uint8)).convert("RGB")
    w0, h0 = image.size
    scale = 1.0
    if max(w0, h0) > imgsz:
        scale = imgsz / float(max(w0, h0))
        image = image.resize((max(1, int(w0 * scale)), max(1, int(h0 * scale))), Image.BILINEAR)
    tensor = to_tensor(image).to(torch_device)
    with torch.inference_mode():
        outputs = model([tensor])[0]
    boxes = outputs["boxes"].detach().cpu().numpy()
    scores = outputs["scores"].detach().cpu().numpy()
    labels = outputs["labels"].detach().cpu().numpy()
    inv = 1.0 / scale if scale else 1.0
    regions: list[DetectedRegion] = []
    for box, score, label in zip(boxes, scores, labels, strict=False):
        if float(score) < conf:
            continue
        idx = int(label) - label_offset
        if idx < 0 or idx >= len(class_names):
            continue
        x1, y1, x2, y2 = [float(v) * inv for v in box]
        if x2 <= x1 or y2 <= y1:
            continue
        name = class_names[idx]
        polygon = [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
        regions.append(
            DetectedRegion(
                id=str(uuid4()),
                type="wall" if name.lower() == "wall" else "space",
                label=name,
                confidence=round(float(score), 4),
                polygon=polygon,
                bbox=(x1, y1, x2 - x1, y2 - y1),
                attributes={
                    "roomType": name,
                    "label": name,
                    "source": f"studio-{kind}",
                },
            )
        )
    return regions, class_names
