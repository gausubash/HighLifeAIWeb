#!/usr/bin/env python3
"""RACE training entrypoint (Phase 6).

Wraps Ultralytics YOLO fine-tune on a prepared data.yaml, then writes a
weights + metadata bundle suitable for upload to shared Storage.

Usage (on RACE):
  cd services/training
  python -m train --data /path/to/data.yaml --model yolov8n-seg.pt --epochs 50 --device cuda
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INFERENCE = ROOT.parent / "inference"
if str(INFERENCE) not in sys.path:
    sys.path.insert(0, str(INFERENCE))


def main() -> int:
    parser = argparse.ArgumentParser(description="Train YOLO weights on RACE")
    parser.add_argument("--data", required=True, type=Path, help="YOLO data.yaml")
    parser.add_argument("--model", default="yolov8n-seg.pt")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cuda")
    parser.add_argument("--out", type=Path, default=Path("artifacts"))
    parser.add_argument("--name", default=None, help="Run / artifact name")
    args = parser.parse_args()

    if not args.data.is_file():
        print(f"data.yaml not found: {args.data}", file=sys.stderr)
        return 1

    try:
        from ultralytics import YOLO
    except ImportError:
        print("Install ultralytics in the RACE venv: pip install ultralytics", file=sys.stderr)
        return 1

    name = args.name or f"race-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    project = out / "runs"

    yolo = YOLO(args.model)
    yolo.train(
        data=str(args.data),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=0 if args.device == "cuda" else "cpu",
        project=str(project),
        name=name,
        exist_ok=True,
        workers=2,
    )
    run_dir = project / name
    best = run_dir / "weights" / "best.pt"
    if not best.is_file():
        print(f"No best.pt under {run_dir}", file=sys.stderr)
        return 1

    bundle = out / name
    bundle.mkdir(parents=True, exist_ok=True)
    dest = bundle / "best.pt"
    shutil.copy2(best, dest)
    meta = {
        "name": name,
        "base_model": args.model,
        "data": str(args.data),
        "epochs": args.epochs,
        "imgsz": args.imgsz,
        "batch": args.batch,
        "device": args.device,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "weights": str(dest),
    }
    (bundle / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "bundle": str(bundle), "weights": str(dest)}, indent=2))
    print("Upload bundle/ to Supabase Storage models/ and register in the model registry.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
