#!/usr/bin/env bash
# CLI YOLO training on RACE (standalone — not Model Studio UI).
#
# Usage:
#   ./scripts/race-train.sh /path/to/data.yaml [model] [epochs]
# Example:
#   ./scripts/race-train.sh ~/datasets/walls/data.yaml yolov8n-seg.pt 50
set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
VENV="$REPO/services/inference/.venv"

DATA="${1:-}"
MODEL="${2:-yolov8n-seg.pt}"
EPOCHS="${3:-50}"
OUT="${OUT:-$REPO/artifacts}"

if [[ -z "$DATA" ]]; then
  echo "Usage: $0 /path/to/data.yaml [model] [epochs]" >&2
  exit 1
fi

[[ -x "$VENV/bin/python" ]] || { echo "Run ./scripts/setup-race.sh first" >&2; exit 1; }
[[ -f "$DATA" ]] || { echo "data.yaml not found: $DATA" >&2; exit 1; }

# shellcheck disable=SC1091
source "$VENV/bin/activate"
cd "$REPO/services/training"

python -m train \
  --data "$DATA" \
  --model "$MODEL" \
  --epochs "$EPOCHS" \
  --device cuda \
  --out "$OUT"

echo "Artifacts: $OUT"
