"""Fine-tune floorData DeepLabV3+ / UNet on Studio YOLO labels (TensorFlow)."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from app.studio.yolo_label_io import load_yolo_boxes, split_from_yaml

STUDIO_FLOORDATA_DEEPLAB = "tensorflow-floordata-deeplab"
STUDIO_FLOORDATA_UNET = "tensorflow-floordata-unet"
STUDIO_FLOORDATA_FRAMEWORKS = frozenset({STUDIO_FLOORDATA_DEEPLAB, STUDIO_FLOORDATA_UNET})
META_SIDECAR = "studio_meta.json"


def is_studio_floordata_checkpoint(path: Path) -> bool:
    if not path.is_file():
        return False
    if path.suffix.lower() != ".h5":
        return False
    meta = path.with_name(META_SIDECAR)
    if meta.is_file():
        try:
            payload = json.loads(meta.read_text(encoding="utf-8"))
            return payload.get("studio_framework") in STUDIO_FLOORDATA_FRAMEWORKS
        except (OSError, json.JSONDecodeError):
            return False
    # Saved Keras model from Studio training without sidecar still usable.
    return True


def _require_tf():
    try:
        import tensorflow as tf
    except ImportError as exc:
        import sys

        raise RuntimeError(
            "floorData fine-tuning needs TensorFlow in this process "
            f"(Python {sys.version_info.major}.{sys.version_info.minor}). "
            "Use services/inference/.venv-tf (Python 3.10–3.12) or set TENSORFLOW_PYTHON."
        ) from exc
    return tf


def tensorflow_available() -> bool:
    """True if TF imports here, or a dedicated TensorFlow Python is configured."""
    try:
        import tensorflow  # noqa: F401

        return True
    except ImportError:
        pass
    try:
        from app.studio.tf_runtime import tensorflow_runtime_available

        return tensorflow_runtime_available()
    except Exception:
        return False


def _yolo_to_mask(
    label_path: Path,
    width: int,
    height: int,
    num_classes: int,
    out_size: int,
) -> np.ndarray:
    """Rasterize YOLO boxes/polygons into a (H, W, C) float mask."""
    image_w, image_h = width, height
    boxes, labels = load_yolo_boxes(label_path, image_w, image_h)
    # Prefer polygon fill when label lines have >4 coords.
    mask = np.zeros((out_size, out_size, num_classes), dtype=np.float32)
    if not label_path.is_file():
        return mask

    scale_x = out_size / float(image_w or 1)
    scale_y = out_size / float(image_h or 1)
    layers = [Image.new("L", (out_size, out_size), 0) for _ in range(num_classes)]
    drawers = [ImageDraw.Draw(layer) for layer in layers]

    for line in label_path.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split()
        if len(parts) < 5:
            continue
        try:
            cls = int(float(parts[0]))
            nums = [float(x) for x in parts[1:]]
        except ValueError:
            continue
        if cls < 0 or cls >= num_classes:
            continue
        if len(nums) == 4:
            cx, cy, bw, bh = nums
            x1 = (cx - bw / 2) * image_w * scale_x
            y1 = (cy - bh / 2) * image_h * scale_y
            x2 = (cx + bw / 2) * image_w * scale_x
            y2 = (cy + bh / 2) * image_h * scale_y
            drawers[cls].rectangle([x1, y1, x2, y2], fill=255)
        else:
            pts: list[float] = []
            for i in range(0, len(nums) - 1, 2):
                pts.append(nums[i] * image_w * scale_x)
                pts.append(nums[i + 1] * image_h * scale_y)
            if len(pts) >= 6:
                drawers[cls].polygon(pts, fill=255)

    for i, layer in enumerate(layers):
        mask[..., i] = np.asarray(layer, dtype=np.float32) / 255.0
    return mask


def _load_pairs(data_yaml: Path, imgsz: int, num_classes: int):
    images, labels = split_from_yaml(data_yaml, "train")
    if not images:
        raise ValueError("No training images found for floorData fine-tune.")
    xs: list[np.ndarray] = []
    ys: list[np.ndarray] = []
    for image_path, label_path in zip(images, labels, strict=False):
        image = Image.open(image_path).convert("RGB").resize((imgsz, imgsz), Image.BILINEAR)
        arr = np.asarray(image).astype(np.float32) / 255.0
        with Image.open(image_path) as raw:
            w0, h0 = raw.size
        mask = _yolo_to_mask(label_path, w0, h0, num_classes, imgsz)
        xs.append(arr)
        ys.append(mask)
    return np.stack(xs), np.stack(ys), images


def build_unet(input_size: int, num_classes: int):
    tf = _require_tf()
    inputs = tf.keras.Input(shape=(input_size, input_size, 3))

    def conv_block(x, filters):
        x = tf.keras.layers.Conv2D(filters, 3, padding="same", activation="relu")(x)
        x = tf.keras.layers.Conv2D(filters, 3, padding="same", activation="relu")(x)
        return x

    c1 = conv_block(inputs, 32)
    p1 = tf.keras.layers.MaxPooling2D()(c1)
    c2 = conv_block(p1, 64)
    p2 = tf.keras.layers.MaxPooling2D()(c2)
    c3 = conv_block(p2, 128)
    p3 = tf.keras.layers.MaxPooling2D()(c3)
    b = conv_block(p3, 256)

    u3 = tf.keras.layers.UpSampling2D()(b)
    u3 = tf.keras.layers.Concatenate()([u3, c3])
    c4 = conv_block(u3, 128)
    u2 = tf.keras.layers.UpSampling2D()(c4)
    u2 = tf.keras.layers.Concatenate()([u2, c2])
    c5 = conv_block(u2, 64)
    u1 = tf.keras.layers.UpSampling2D()(c5)
    u1 = tf.keras.layers.Concatenate()([u1, c1])
    c6 = conv_block(u1, 32)

    activation = "sigmoid" if num_classes == 1 else "softmax"
    outputs = tf.keras.layers.Conv2D(num_classes, 1, activation=activation)(c6)
    return tf.keras.Model(inputs, outputs, name="studio_floordata_unet")


def build_deeplab(input_size: int, num_classes: int):
    """DeepLabV3+-style head on ResNet50 (floorData-inspired), RGB in → mask out."""
    tf = _require_tf()
    inputs = tf.keras.Input(shape=(input_size, input_size, 3))
    base = tf.keras.applications.ResNet50(
        include_top=False,
        weights="imagenet",
        input_tensor=inputs,
    )
    features = base.output

    def aspp_branch(x, kernel, rate):
        y = tf.keras.layers.Conv2D(
            128, kernel, padding="same", dilation_rate=rate, use_bias=False
        )(x)
        y = tf.keras.layers.BatchNormalization()(y)
        return tf.keras.layers.Activation("relu")(y)

    b1 = aspp_branch(features, 1, 1)
    b2 = aspp_branch(features, 3, 6)
    b3 = aspp_branch(features, 3, 12)
    pooled = tf.keras.layers.GlobalAveragePooling2D(keepdims=True)(features)
    pooled = tf.keras.layers.Conv2D(128, 1, padding="same", use_bias=False)(pooled)
    pooled = tf.keras.layers.BatchNormalization()(pooled)
    pooled = tf.keras.layers.Activation("relu")(pooled)
    pooled = tf.keras.layers.Resizing(
        int(features.shape[1] or input_size // 32),
        int(features.shape[2] or input_size // 32),
        interpolation="bilinear",
    )(pooled)

    x = tf.keras.layers.Concatenate()([b1, b2, b3, pooled])
    x = tf.keras.layers.Conv2D(256, 1, padding="same", use_bias=False)(x)
    x = tf.keras.layers.BatchNormalization()(x)
    x = tf.keras.layers.Activation("relu")(x)
    x = tf.keras.layers.Resizing(input_size, input_size, interpolation="bilinear")(x)
    activation = "sigmoid" if num_classes == 1 else "softmax"
    outputs = tf.keras.layers.Conv2D(num_classes, 1, activation=activation)(x)
    return tf.keras.Model(inputs, outputs, name="studio_floordata_deeplab")


def _try_load_pretrained(path: Path, kind: str, input_size: int, num_classes: int):
    tf = _require_tf()
    model = build_deeplab(input_size, num_classes) if kind == "deeplab" else build_unet(input_size, num_classes)
    if not path.is_file():
        return model, False
    try:
        pretrained = tf.keras.models.load_model(str(path), compile=False)
        model.set_weights(pretrained.get_weights())
        return model, True
    except Exception:
        try:
            model.load_weights(str(path), by_name=True, skip_mismatch=True)
            return model, True
        except Exception:
            return model, False


def _write_preview(model, image_path: Path, out_path: Path, class_names: list[str], imgsz: int) -> bool:
    try:
        image = Image.open(image_path).convert("RGB")
        resized = image.resize((imgsz, imgsz), Image.BILINEAR)
        batch = np.expand_dims(np.asarray(resized).astype(np.float32) / 255.0, axis=0)
        pred = model.predict(batch, verbose=0)[0]
        if pred.ndim == 3 and pred.shape[-1] > 1:
            cls_map = np.argmax(pred, axis=-1)
            conf = np.max(pred, axis=-1)
        else:
            probs = pred[..., 0] if pred.ndim == 3 else pred
            cls_map = (probs >= 0.5).astype(np.int32)
            conf = probs
        overlay = resized.copy().convert("RGBA")
        draw = ImageDraw.Draw(overlay)
        # Draw coarse boxes around connected components per class.
        for cls_idx, name in enumerate(class_names):
            binary = (cls_map == cls_idx).astype(np.uint8)
            if binary.max() == 0:
                continue
            ys, xs = np.where(binary)
            if xs.size == 0:
                continue
            x0, x1 = int(xs.min()), int(xs.max())
            y0, y1 = int(ys.min()), int(ys.max())
            score = float(conf[binary > 0].mean()) if np.any(binary) else 0.0
            draw.rectangle([x0, y0, x1, y1], outline=(220, 38, 38, 255), width=2)
            draw.text((x0 + 2, y0 + 2), f"{name} {score:.2f}", fill=(220, 38, 38, 255))
        out_path.parent.mkdir(parents=True, exist_ok=True)
        overlay.convert("RGB").save(out_path, format="PNG")
        return True
    except Exception:
        return False


def train_floordata(
    *,
    kind: str,
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
    tf = _require_tf()
    if device != "cuda":
        try:
            tf.config.set_visible_devices([], "GPU")
        except Exception:
            pass

    kind = "deeplab" if kind == "deeplab" else "unet"
    num_classes = max(1, len(class_names))
    size = max(64, int(imgsz))
    # DeepLab ResNet prefers multiples of 32.
    size = max(64, (size // 32) * 32)

    x_train, y_train, train_images = _load_pairs(data_yaml, size, num_classes)
    model, warmed = _try_load_pretrained(
        pretrained_path or Path(""),
        kind,
        size,
        num_classes,
    )
    loss = "binary_crossentropy" if num_classes == 1 else "categorical_crossentropy"
    model.compile(optimizer=tf.keras.optimizers.Adam(1e-4), loss=loss, metrics=["accuracy"])

    run_dir = project / name
    run_dir.mkdir(parents=True, exist_ok=True)
    csv_path = run_dir / "results.csv"
    best_loss = float("inf")
    sample = train_images[0]
    framework = STUDIO_FLOORDATA_DEEPLAB if kind == "deeplab" else STUDIO_FLOORDATA_UNET

    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["epoch", "train/loss", "train/accuracy"])

        for epoch in range(1, max(1, epochs) + 1):
            history = model.fit(
                x_train,
                y_train,
                batch_size=max(1, batch),
                epochs=1,
                verbose=0,
            )
            loss_v = float(history.history["loss"][0])
            acc_v = float(history.history.get("accuracy", [0.0])[0])
            writer.writerow([epoch, f"{loss_v:.6f}", f"{acc_v:.6f}"])
            handle.flush()

            last_path = run_dir / "last.h5"
            model.save(str(last_path))
            if loss_v <= best_loss:
                best_loss = loss_v
                weights_out.parent.mkdir(parents=True, exist_ok=True)
                model.save(str(weights_out))
                meta = {
                    "studio_framework": framework,
                    "class_names": list(class_names),
                    "kind": kind,
                    "imgsz": size,
                    "warm_started": warmed,
                }
                weights_out.with_name(META_SIDECAR).write_text(
                    json.dumps(meta, indent=2), encoding="utf-8"
                )
                last_path.with_name(META_SIDECAR).write_text(
                    json.dumps(meta, indent=2), encoding="utf-8"
                )

            if on_epoch is not None:
                preview_ok = False
                if preview_path is not None:
                    preview_ok = _write_preview(model, sample, preview_path, class_names, size)
                on_epoch(
                    epoch,
                    epochs,
                    metrics={"train/loss": loss_v, "train/accuracy": acc_v},
                    last_weights=last_path if last_path.is_file() else None,
                    sample=sample,
                    preview_ok=preview_ok,
                )

    if not weights_out.is_file():
        raise FileNotFoundError("floorData training finished but no weights were saved.")
    return weights_out


def load_studio_floordata(path: Path):
    tf = _require_tf()
    model = tf.keras.models.load_model(str(path), compile=False)
    meta_path = path.with_name(META_SIDECAR)
    class_names = ["wall"]
    framework = STUDIO_FLOORDATA_UNET
    if meta_path.is_file():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        class_names = [str(x) for x in (meta.get("class_names") or class_names)]
        framework = str(meta.get("studio_framework") or framework)
    return model, class_names, framework


def detect_studio_floordata(
    rgb: np.ndarray,
    *,
    weights_path: Path,
    conf: float = 0.25,
    imgsz: int = 512,
):
    from uuid import uuid4

    from app.studio.tf_runtime import predict_mask_with_runtime, tensorflow_runtime_hint
    from app.yolo.mitunet import mask_to_polygons
    from app.yolo.predict import DetectedRegion

    if not tensorflow_available():
        raise RuntimeError("Studio floorData detect needs TensorFlow. " + tensorflow_runtime_hint())

    meta_path = Path(weights_path).with_name(META_SIDECAR)
    class_names = ["wall"]
    framework = STUDIO_FLOORDATA_UNET
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            class_names = [str(x) for x in (meta.get("class_names") or class_names)]
            framework = str(meta.get("studio_framework") or framework)
        except (OSError, json.JSONDecodeError):
            pass

    pred = predict_mask_with_runtime(rgb, weights_path=Path(weights_path), imgsz=imgsz)
    height, width = rgb.shape[:2]
    regions: list[DetectedRegion] = []

    def _add(name: str, probs: np.ndarray) -> None:
        binary = probs >= conf
        if not np.any(binary):
            return
        score = float(probs[binary].mean())
        polygons = mask_to_polygons(binary.astype(np.uint8))
        for poly in polygons:
            pts = [(float(x), float(y)) for x, y in poly]
            if len(pts) < 3:
                continue
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            regions.append(
                DetectedRegion(
                    id=str(uuid4()),
                    type="wall" if name.lower() == "wall" else "space",
                    label=name,
                    confidence=round(score, 4),
                    polygon=pts,
                    bbox=(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)),
                    attributes={"roomType": name, "label": name, "source": "studio-floordata"},
                )
            )

    if pred.ndim == 2 or (pred.ndim == 3 and pred.shape[-1] == 1):
        probs = pred if pred.ndim == 2 else pred[..., 0]
        _add(class_names[0] if class_names else "wall", probs)
    elif pred.ndim == 3:
        for cls_idx, name in enumerate(class_names):
            if cls_idx >= pred.shape[-1]:
                break
            _add(name, pred[..., cls_idx])
    return regions, class_names, framework


def write_floordata_preview(weights_path: Path, sample: Path, out_path: Path, imgsz: int = 512) -> bool:
    try:
        from app.studio.tf_runtime import predict_mask_with_runtime

        if not sample.is_file():
            return False
        rgb = np.asarray(Image.open(sample).convert("RGB"), dtype=np.uint8)
        pred = predict_mask_with_runtime(rgb, weights_path=Path(weights_path), imgsz=imgsz)
        meta_path = Path(weights_path).with_name(META_SIDECAR)
        class_names = ["wall"]
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                class_names = [str(x) for x in (meta.get("class_names") or class_names)]
            except (OSError, json.JSONDecodeError):
                pass
        # Build a tiny fake Keras-less preview via PIL overlay.
        size = max(64, (int(imgsz) // 32) * 32)
        resized = Image.fromarray(rgb).resize((size, size), Image.BILINEAR).convert("RGBA")
        draw = ImageDraw.Draw(resized)
        if pred.ndim == 3 and pred.shape[-1] > 1:
            cls_map = np.argmax(pred, axis=-1)
            conf = np.max(pred, axis=-1)
        else:
            probs = pred[..., 0] if pred.ndim == 3 else pred
            # Resize probs to preview size if needed
            if probs.shape[0] != size or probs.shape[1] != size:
                probs = np.asarray(
                    Image.fromarray(probs.astype(np.float32), mode="F").resize((size, size), Image.BILINEAR)
                )
            cls_map = (probs >= 0.5).astype(np.int32)
            conf = probs
        if cls_map.shape[0] != size or cls_map.shape[1] != size:
            # Approximate with bbox of any positive
            ys, xs = np.where(cls_map > 0) if cls_map.ndim == 2 else (np.array([]), np.array([]))
        else:
            for cls_idx, name in enumerate(class_names):
                binary = (cls_map == cls_idx).astype(np.uint8)
                if binary.max() == 0:
                    continue
                ys, xs = np.where(binary)
                if xs.size == 0:
                    continue
                x0, x1 = int(xs.min()), int(xs.max())
                y0, y1 = int(ys.min()), int(ys.max())
                score = float(conf[binary > 0].mean()) if np.any(binary) else 0.0
                draw.rectangle([x0, y0, x1, y1], outline=(220, 38, 38, 255), width=2)
                draw.text((x0 + 2, y0 + 2), f"{name} {score:.2f}", fill=(220, 38, 38, 255))
        out_path.parent.mkdir(parents=True, exist_ok=True)
        resized.convert("RGB").save(out_path, format="PNG")
        return out_path.is_file()
    except Exception:
        return False
