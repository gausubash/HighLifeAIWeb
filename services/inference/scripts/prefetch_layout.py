"""Download GreenMap yolo11x-blueprint-layout-detector weights for local inference.

Usage:
  .venv\\Scripts\\python.exe scripts/prefetch_layout.py
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

HF_URL = (
    "https://huggingface.co/GreenMap/yolo11x-blueprint-layout-detector/"
    "resolve/main/yolo_layout.pt"
)
OUT = ROOT / "models" / "yolo_layout.pt"


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.is_file() and OUT.stat().st_size > 1_000_000:
        print(f"Already cached: {OUT} ({OUT.stat().st_size} bytes)")
        return 0

    print(f"Downloading {HF_URL}")
    print(f"  -> {OUT}")
    req = urllib.request.Request(HF_URL, headers={"User-Agent": "HighLifeAIWeb/1.0"})
    with urllib.request.urlopen(req, timeout=600) as resp:
        data = resp.read()
    OUT.write_bytes(data)
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
