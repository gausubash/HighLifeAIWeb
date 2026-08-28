"""Download PaddleOCR-VL weights from Hugging Face for offline / local inference.

Usage:
  services\\inference\\.venv-ocr\\Scripts\\python.exe scripts/download_paddleocr_vl.py

Weights go to services/inference/models/paddleocr-vl
Then set in .env:
  PADDLE_OCR_VL_REC_MODEL_DIR=.../services/inference/models/paddleocr-vl
  PADDLE_OCR_VL_LAYOUT_MODEL_DIR=.../services/inference/models/paddleocr-vl/PP-DocLayoutV2
  PADDLE_OCR_VL_PIPELINE_VERSION=v1
  (v1 matches the snapshot's PP-DocLayoutV2; paddleocr 3.7's default v1.6 wants V3)
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.pipeline.paddle_ocr_vl import DEFAULT_VL_REC_DIR, HF_VL_REPO_ID, looks_like_vl_weights


def main() -> int:
    dest = DEFAULT_VL_REC_DIR
    dest.mkdir(parents=True, exist_ok=True)
    if looks_like_vl_weights(dest):
        print(f"Already present: {dest}")
        print("Set PADDLE_OCR_VL_REC_MODEL_DIR to this folder (or leave empty to auto-detect).")
        return 0

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("Installing huggingface_hub …")
        import subprocess

        subprocess.check_call([sys.executable, "-m", "pip", "install", "huggingface_hub>=0.23"])
        from huggingface_hub import snapshot_download

    print(f"Downloading {HF_VL_REPO_ID}")
    print(f"  -> {dest}")
    snapshot_download(
        repo_id=HF_VL_REPO_ID,
        local_dir=str(dest),
    )
    if not looks_like_vl_weights(dest):
        print(f"Download finished but weights were not found in {dest}", file=sys.stderr)
        return 1
    print(f"Ready: {dest}")
    print(f"Add to services/inference/.env:")
    print(f"  PADDLE_OCR_VL_REC_MODEL_DIR={dest}")
    layout = dest / "PP-DocLayoutV2"
    if layout.is_dir():
        print(f"  PADDLE_OCR_VL_LAYOUT_MODEL_DIR={layout}")
        print("  PADDLE_OCR_VL_PIPELINE_VERSION=v1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
