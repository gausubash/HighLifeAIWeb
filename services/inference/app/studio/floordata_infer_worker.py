"""CLI worker: floorData mask predict inside the TensorFlow venv.

Reads one JSON object from stdin; writes mask .npy and emits NDJSON:
  {"type":"done","mask_path":"...","height":H,"width":W,"channels":C}
  {"type":"error","message":"..."}
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

import numpy as np
from PIL import Image

from app.yolo.letterbox import letterbox_rgb, unletterbox_mask


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, default=str) + "\n")
    sys.stdout.flush()


def _load_model(weights: Path):
    import tensorflow as tf

    return tf.keras.models.load_model(str(weights), compile=False)


def _predict_mask(rgb: np.ndarray, model, imgsz: int) -> np.ndarray:
    size = max(32, int(imgsz))
    if size >= 64:
        size = max(64, (size // 32) * 32)

    canvas, scale, ox, oy, orig_hw = letterbox_rgb(rgb, size, fill=255, center=True)
    array = canvas.astype(np.float32) / 255.0

    shape = getattr(model, "input_shape", None)
    channels = 3
    if shape is not None and len(shape) >= 4 and shape[-1] is not None:
        channels = int(shape[-1])

    if channels == 1:
        gray = np.mean(array, axis=-1, keepdims=True)
        batch = np.expand_dims(gray, axis=0)
    else:
        batch = np.expand_dims(array, axis=0)

    pred = model.predict(batch, verbose=0)
    if isinstance(pred, (list, tuple)):
        pred = pred[0]
    mask = np.asarray(pred)
    if mask.ndim == 4:
        mask = mask[0]
    # Model output may not match letterbox size — resize square→square first.
    if mask.ndim == 2 and (mask.shape[0] != size or mask.shape[1] != size):
        mask = np.asarray(
            Image.fromarray(mask.astype(np.float32), mode="F").resize((size, size), Image.BILINEAR),
            dtype=np.float32,
        )
    elif mask.ndim == 3 and (mask.shape[0] != size or mask.shape[1] != size):
        ch = mask.shape[-1]
        resized = np.zeros((size, size, ch), dtype=np.float32)
        for c in range(ch):
            resized[..., c] = np.asarray(
                Image.fromarray(mask[..., c].astype(np.float32), mode="F").resize(
                    (size, size), Image.BILINEAR
                ),
                dtype=np.float32,
            )
        mask = resized

    return unletterbox_mask(
        mask,
        scale=scale,
        offset_x=ox,
        offset_y=oy,
        orig_hw=orig_hw,
        canvas_size=size,
    )


def main() -> int:
    try:
        raw = sys.stdin.readline()
        if not raw.strip():
            raise ValueError("Expected JSON job payload on stdin.")
        job = json.loads(raw.lstrip("\ufeff"))
        image_path = Path(job["image_path"])
        weights_path = Path(job["weights_path"])
        mask_path = Path(job["mask_path"])
        imgsz = int(job.get("imgsz") or 512)
        if not image_path.is_file():
            raise FileNotFoundError(f"Image not found: {image_path}")
        if not weights_path.is_file():
            raise FileNotFoundError(f"Weights not found: {weights_path}")

        rgb = np.asarray(Image.open(image_path).convert("RGB"), dtype=np.uint8)
        model = _load_model(weights_path)
        mask = _predict_mask(rgb, model, imgsz)
        mask_path.parent.mkdir(parents=True, exist_ok=True)
        np.save(str(mask_path), mask)
        _emit(
            {
                "type": "done",
                "mask_path": str(mask_path),
                "height": int(mask.shape[0]),
                "width": int(mask.shape[1]),
                "channels": int(mask.shape[2]) if mask.ndim == 3 else 1,
            }
        )
        return 0
    except KeyboardInterrupt:
        _emit(
            {
                "type": "error",
                "message": "Inference cancelled (interrupted).",
                "cancelled": True,
            }
        )
        return 130
    except Exception as exc:
        _emit({"type": "error", "message": str(exc), "trace": traceback.format_exc()})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
