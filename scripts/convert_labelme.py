#!/usr/bin/env python3
"""Convert LabelMe JSON files (one per page) to YOLO-seg. Delegates to services/inference."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INFERENCE = ROOT / "services" / "inference"
sys.path.insert(0, str(INFERENCE))

from app.yolo.convert_labelme import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
