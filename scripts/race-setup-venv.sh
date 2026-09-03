#!/usr/bin/env bash
# RACE: one Python 3.11 venv (services/inference/.venv) for GPU inference + PaddleOCR-VL.
#
# Run on RACE:  bash ~/HighLifeAIWeb/scripts/race-setup-venv.sh
# From laptop:  npm run race:fix-venv
#
# Options: --rebuild   delete and recreate .venv
set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
INF="$REPO/services/inference"
ENV_FILE="$INF/.env"
VENV="$INF/.venv"
MODELS="$INF/models/paddleocr-vl"
REBUILD=0

for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=1 ;;
    -h|--help)
      sed -n '2,8p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

log() { printf '==> %s\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

pick_python() {
  if command -v python3.11 >/dev/null 2>&1; then
    echo python3.11
    return 0
  fi
  die "python3.11 required. Install: sudo apt-get install -y python3.11 python3.11-venv python3.11-dev"
}

set_kv() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >>"$ENV_FILE"
  fi
}

install_torch_cuda() {
  log "Installing PyTorch (CUDA 12.4 wheels)"
  pip install -U torch torchvision --index-url https://download.pytorch.org/whl/cu124
}

install_paddle_gpu() {
  local idx
  for idx in cu124 cu126; do
    log "Trying paddlepaddle-gpu via ${idx}"
    if pip install -U "paddlepaddle-gpu==3.2.1" -i "https://www.paddlepaddle.org.cn/packages/stable/${idx}/"; then
      if python - <<'PY'
import paddle
paddle.utils.run_check()
assert paddle.device.is_compiled_with_cuda()
print("paddle device:", paddle.device.get_device())
PY
      then
        return 0
      fi
    fi
    pip uninstall -y paddlepaddle-gpu paddlepaddle 2>/dev/null || true
  done
  die "Could not install working paddlepaddle-gpu"
}

[[ -d "$INF" ]] || die "Missing $INF"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$INF/.env.example" "$ENV_FILE"
  log "Created $ENV_FILE from .env.example"
fi

PY="$(pick_python)"
log "Using $PY ($($PY --version 2>&1))"

if [[ "$REBUILD" -eq 1 && -d "$VENV" ]]; then
  log "Removing old $VENV (--rebuild)"
  rm -rf "$VENV"
fi

if [[ ! -d "$VENV" ]]; then
  log "Creating unified venv at $VENV"
  "$PY" -m venv "$VENV"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install -U pip wheel setuptools

if ! python -c "import torch; assert torch.cuda.is_available()" 2>/dev/null; then
  install_torch_cuda
else
  log "PyTorch CUDA already OK"
fi

pip install -r "$INF/requirements-race-gpu.txt"

if ! python -c "import paddle; assert paddle.device.is_compiled_with_cuda()" 2>/dev/null; then
  install_paddle_gpu
else
  log "Paddle GPU already OK"
fi

log "Smoke tests"
python - <<'PY'
import numpy, torch, paddle
print("numpy", numpy.__version__)
print("torch", torch.__version__, "cuda", torch.cuda.is_available())
print("paddle", paddle.__version__, paddle.device.get_device())
from paddleocr import PaddleOCRVL  # noqa: F401
from ultralytics import YOLO  # noqa: F401
print("imports OK")
PY

if [[ ! -d "$MODELS" ]] || [[ -z "$(ls -A "$MODELS" 2>/dev/null || true)" ]]; then
  log "Downloading PaddleOCR-VL weights (~2GB)"
  (cd "$INF" && python scripts/download_paddleocr_vl.py) \
    || log "WARN: PaddleOCR-VL download failed — retry later"
else
  log "PaddleOCR-VL weights present at $MODELS"
fi

log "Prefetch YOLO / Architect weights (best-effort)"
(cd "$INF" && python scripts/prefetch_layout.py) || true
(cd "$INF" && python scripts/prefetch_architect.py) || true

PY_BIN="$VENV/bin/python"
LAYOUT_DIR="$MODELS/PP-DocLayoutV2"

log "Patching $ENV_FILE (single venv for inference + OCR)"
set_kv RUN_MODE real
set_kv DEVICE auto
set_kv API_HOST 127.0.0.1
set_kv API_PORT 8000
set_kv PADDLE_OCR_ENABLED true
set_kv VLM_PROVIDER paddleocr
set_kv PADDLE_OCR_BACKEND vl
set_kv PADDLE_OCR_USE_GPU true
set_kv PADDLE_OCR_LANG en
set_kv PADDLE_OCR_PYTHON "$PY_BIN"
set_kv PADDLE_OCR_VL_PIPELINE_VERSION v1
set_kv PADDLE_OCR_VL_REC_MODEL_DIR "$MODELS"
if [[ -d "$LAYOUT_DIR" ]]; then
  set_kv PADDLE_OCR_VL_LAYOUT_MODEL_DIR "$LAYOUT_DIR"
fi
set_kv USE_ROOM_DETECTOR true
set_kv YOLO_ROOM_WEIGHTS models/architect_floorplan.pt

grep -E '^(RUN_MODE|DEVICE|PADDLE_OCR_PYTHON|PADDLE_OCR_BACKEND)=' "$ENV_FILE"

if [[ -d "$INF/.venv-ocr" ]]; then
  log "Note: .venv-ocr is unused — this install uses $VENV only"
fi

if [[ -f "$REPO/scripts/race-services.sh" ]]; then
  log "Restart inference API + worker"
  bash "$REPO/scripts/race-services.sh" stop || true
  bash "$REPO/scripts/race-services.sh" start
  sleep 4
  bash "$REPO/scripts/race-services.sh" status
fi

log "Done. Unified venv: $VENV"
log "Verify: curl http://127.0.0.1:8000/health  (device=cuda, paddle_ocr_vl_ready=true)"
