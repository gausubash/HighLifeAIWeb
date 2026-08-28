"""CLI worker: run floorData fine-tune inside the TensorFlow venv.

Reads one JSON object from stdin; emits NDJSON events on stdout:
  {"type":"epoch", ...}
  {"type":"done","weights_out":"..."}
  {"type":"error","message":"..."}
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, default=str) + "\n")
    sys.stdout.flush()


def main() -> int:
    try:
        raw = sys.stdin.readline()
        if not raw.strip():
            raise ValueError("Expected JSON job payload on stdin.")
        job = json.loads(raw.lstrip("\ufeff"))
        from app.studio.floordata_train import train_floordata

        def on_epoch(current: int, total: int, **kwargs) -> None:
            last = kwargs.get("last_weights")
            sample = kwargs.get("sample")
            _emit(
                {
                    "type": "epoch",
                    "current": current,
                    "total": total,
                    "metrics": dict(kwargs.get("metrics") or {}),
                    "last_weights": str(last) if last else None,
                    "sample": str(sample) if sample else None,
                    "preview_ok": bool(kwargs.get("preview_ok")),
                }
            )

        pretrained = str(job.get("pretrained_path") or "").strip()
        preview = str(job.get("preview_path") or "").strip()
        out = train_floordata(
            kind=str(job.get("kind") or "unet"),
            data_yaml=Path(job["data_yaml"]),
            weights_out=Path(job["weights_out"]),
            pretrained_path=Path(pretrained) if pretrained else None,
            class_names=[str(x) for x in (job.get("class_names") or ["wall"])],
            epochs=int(job.get("epochs") or 30),
            imgsz=int(job.get("imgsz") or 512),
            batch=int(job.get("batch") or 2),
            device=str(job.get("device") or "cpu"),
            project=Path(job["project"]),
            name=str(job.get("name") or "floordata"),
            on_epoch=on_epoch,
            preview_path=Path(preview) if preview else None,
        )
        _emit({"type": "done", "weights_out": str(out)})
        return 0
    except KeyboardInterrupt:
        _emit(
            {
                "type": "error",
                "message": "Training cancelled (interrupted). Re-run fine-tune — avoid uvicorn --reload while training.",
                "cancelled": True,
            }
        )
        return 130
    except Exception as exc:
        _emit({"type": "error", "message": str(exc), "trace": traceback.format_exc()})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
