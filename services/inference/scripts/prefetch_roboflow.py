"""Download / cache Roboflow floorplan-iculh weights for on-device inference.

Universe models do not expose a public .pt URL. Roboflow Inference caches the
weights under MODEL_CACHE_DIR on first load; later runs stay local.

Usage (Python 3.10–3.12 with ``inference`` installed, e.g. .venv-tf):

  .venv-tf\\Scripts\\python.exe scripts/prefetch_roboflow.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent.parent / ".env")

CACHE = ROOT / "models" / "roboflow_cache"
DEFAULT_MODEL = "floor-r1kta/floorplan-iculh/1"


def main() -> int:
    key = (os.getenv("ROBOFLOW_API_KEY") or "").strip()
    model_id = (os.getenv("ROBOFLOW_MODEL_ID") or "").strip() or "floorplan-iculh/1"
    # Inference expects project/version (not workspace/project/version).
    parts = [p for p in model_id.split("/") if p]
    if len(parts) >= 2:
        model_id = f"{parts[-2]}/{parts[-1]}"
    if not key:
        print("ROBOFLOW_API_KEY is empty. Add it to services/inference/.env", file=sys.stderr)
        return 1

    CACHE.mkdir(parents=True, exist_ok=True)
    os.environ["MODEL_CACHE_DIR"] = str(CACHE)
    os.environ["ROBOFLOW_API_KEY"] = key

    print(f"Cache: {CACHE}")
    print(f"Loading {model_id} (downloads weights on first run)…")
    try:
        from inference import get_model
    except ImportError:
        print(
            "Install Roboflow Inference in a Python 3.10–3.12 venv:\n"
            "  .venv-tf\\Scripts\\python.exe -m pip install inference\n"
            "Main .venv is Python 3.13+ and cannot install that package.",
            file=sys.stderr,
        )
        return 1

    model = get_model(model_id=model_id, api_key=key)
    print(f"Model ready: {type(model).__name__}")

    pt_files = sorted(CACHE.rglob("*.pt"))
    onnx_files = sorted(CACHE.rglob("*.onnx"))
    print(f"Cached .pt files: {len(pt_files)}")
    for path in pt_files[:20]:
        print(f"  {path.relative_to(CACHE)} ({path.stat().st_size} bytes)")
    print(f"Cached .onnx files: {len(onnx_files)}")
    for path in onnx_files[:20]:
        print(f"  {path.relative_to(CACHE)} ({path.stat().st_size} bytes)")

    marker = CACHE / "floorplan-iculh.ready"
    marker.write_text(f"{model_id}\n", encoding="utf-8")
    print(f"Wrote {marker}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
