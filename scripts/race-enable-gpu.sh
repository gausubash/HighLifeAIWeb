#!/usr/bin/env bash
# Force GPU inference settings on RACE and restart services.
# Run on RACE: bash ~/HighLifeAIWeb/scripts/race-enable-gpu.sh
# Or from laptop: npm run race:fix-gpu
set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
INF="$REPO/services/inference"
ENV_FILE="$INF/.env"
VENV="$INF/.venv"

log() { printf '==> %s\n' "$*"; }

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$INF/.env.example" "$ENV_FILE"
  log "Created $ENV_FILE from .env.example"
fi

set_kv() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >>"$ENV_FILE"
  fi
}

log "Patching $ENV_FILE for RACE GPU"
set_kv RUN_MODE real
set_kv DEVICE auto
set_kv API_HOST 127.0.0.1
set_kv API_PORT 8000

grep -E '^(RUN_MODE|DEVICE|API_HOST|API_PORT)=' "$ENV_FILE"

if [[ -x "$VENV/bin/python" ]]; then
  log "CUDA smoke test (torch)"
  if ! "$VENV/bin/python" - <<'PY'
import sys
import torch
print("torch", torch.__version__)
ok = torch.cuda.is_available()
print("cuda available", ok)
if ok:
    print("gpu", torch.cuda.get_device_name(0))
else:
    print("device_count", torch.cuda.device_count(), file=sys.stderr)
    sys.exit(1)
PY
  then
    echo "WARN: torch.cuda.is_available() is false — reinstalling CUDA PyTorch wheels" >&2
    # shellcheck disable=SC1091
    source "$VENV/bin/activate"
    pip install -U torch torchvision --index-url https://download.pytorch.org/whl/cu124
    "$VENV/bin/python" - <<'PY'
import torch
print("torch", torch.__version__)
print("cuda available", torch.cuda.is_available())
if torch.cuda.is_available():
    print("gpu", torch.cuda.get_device_name(0))
PY
  fi
else
  echo "WARN: $VENV not found — run ./scripts/setup-race.sh first" >&2
fi

if [[ -f "$REPO/scripts/race-services.sh" ]]; then
  log "Restart inference API + worker"
  bash "$REPO/scripts/race-services.sh" stop || true
  bash "$REPO/scripts/race-services.sh" start
  sleep 2
  bash "$REPO/scripts/race-services.sh" status
fi

log "Done. Expect: \"device\": \"cuda\" in /health when torch sees the GPU"
