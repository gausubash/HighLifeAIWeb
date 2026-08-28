"""Write ImageNet-init floorData Keras checkpoints for Detect (`wall:deeplab` / UNet).

floorData does not ship pretrained wall .h5 files. This builds the same architecture
Studio uses (ResNet50 ImageNet backbone + DeepLab-style head, or UNet) and saves:

  models/deeplab_walls_best.h5
  models/unet_walls_best.h5

The decoder is untrained — Detect will run, but wall quality stays poor until you
fine-tune in Model Studio (or replace these files with your own trained .h5).

Usage (TensorFlow venv):

  .venv-tf\\Scripts\\python.exe scripts/bootstrap_floordata_weights.py
  .venv-tf\\Scripts\\python.exe scripts/bootstrap_floordata_weights.py --kind deeplab
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent.parent / ".env")

from app.studio.floordata_train import (  # noqa: E402
    META_SIDECAR,
    STUDIO_FLOORDATA_DEEPLAB,
    STUDIO_FLOORDATA_UNET,
    build_deeplab,
    build_unet,
)
from app.yolo.wall_registry import default_legacy_wall_path  # noqa: E402


def _write_meta(path: Path, *, kind: str, imgsz: int) -> None:
    framework = STUDIO_FLOORDATA_DEEPLAB if kind == "deeplab" else STUDIO_FLOORDATA_UNET
    meta = {
        "studio_framework": framework,
        "kind": kind,
        "imgsz": imgsz,
        "num_classes": 1,
        "bootstrap": "imagenet_backbone_untrained_decoder",
        "note": "Replace with a Studio fine-tune or floorData-trained checkpoint for usable walls.",
    }
    path.with_name(META_SIDECAR).write_text(json.dumps(meta, indent=2), encoding="utf-8")


def bootstrap(kind: str, *, imgsz: int, force: bool) -> Path:
    kind = kind.strip().lower()
    if kind == "unet":
        kind = "unet_floordata"
    out = default_legacy_wall_path("deeplab" if kind == "deeplab" else "unet_floordata")
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.is_file() and not force:
        print(f"skip (exists): {out}")
        return out

    print(f"building {kind} imgsz={imgsz} → {out}")
    if kind == "deeplab":
        model = build_deeplab(imgsz, 1)
    else:
        model = build_unet(imgsz, 1)
    model.save(str(out))
    _write_meta(out, kind="deeplab" if kind == "deeplab" else "unet", imgsz=imgsz)
    print(f"wrote {out} ({out.stat().st_size} bytes)")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--kind",
        choices=("deeplab", "unet", "unet_floordata", "all"),
        default="all",
        help="Which checkpoint(s) to write (default: all).",
    )
    parser.add_argument("--imgsz", type=int, default=512)
    parser.add_argument("--force", action="store_true", help="Overwrite existing .h5 files.")
    args = parser.parse_args()

    try:
        import tensorflow  # noqa: F401
    except ImportError:
        print(
            "TensorFlow is required. Run with:\n"
            "  .venv-tf\\Scripts\\python.exe scripts/bootstrap_floordata_weights.py",
            file=sys.stderr,
        )
        return 1

    kinds = ("deeplab", "unet_floordata") if args.kind == "all" else (args.kind,)
    for kind in kinds:
        bootstrap(kind, imgsz=max(64, int(args.imgsz)), force=args.force)
    print(
        "Done. Restart the inference API if it is already running, then pick "
        "wall:deeplab / wall:unet_floordata in Detect."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
