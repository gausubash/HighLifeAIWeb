#!/usr/bin/env bash
# HighLife RACE — one-time Ubuntu workstation bootstrap + GPU Python env.
#
# Fresh VM (no clone yet):
#   curl -fsSL https://raw.githubusercontent.com/gausubash/HighLifeAIWeb/main/scripts/setup-race.sh | bash
#
# Already cloned:
#   ./scripts/setup-race.sh
#
# Options:
#   --skip-apt       Skip apt packages (git, build tools, poppler, …)
#   --skip-vscode    Skip VS Code CLI install
#   --skip-gh        Skip GitHub CLI install
#   --skip-clone     Skip git clone / pull (run from repo only)
#   --skip-gpu       Skip Python venv + requirements-gpu.txt
#   REPO_DIR=…       Clone destination (default: ~/HighLifeAIWeb)
#   REPO_URL=…       Git remote (default: gausubash/HighLifeAIWeb)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/gausubash/HighLifeAIWeb.git}"
REPO_DIR="${REPO_DIR:-$HOME/HighLifeAIWeb}"
SKIP_APT=0
SKIP_VSCODE=0
SKIP_GH=0
SKIP_CLONE=0
SKIP_GPU=0

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \?//'
  exit "${1:-0}"
}

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage 0 ;;
    --skip-apt) SKIP_APT=1 ;;
    --skip-vscode) SKIP_VSCODE=1 ;;
    --skip-gh) SKIP_GH=1 ;;
    --skip-clone) SKIP_CLONE=1 ;;
    --skip-gpu) SKIP_GPU=1 ;;
    *) echo "Unknown option: $arg" >&2; usage 1 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

require_linux() {
  [[ "$(uname -s)" == "Linux" ]] || die "This script is for Ubuntu/Linux RACE workstations only."
}

repo_root_from_script() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -d "$script_dir/../services/inference" ]]; then
    cd "$script_dir/.." && pwd
    return 0
  fi
  return 1
}

install_apt_packages() {
  log "System packages (git, Python, PDF raster, OpenCV deps)"
  sudo apt-get update -qq
  sudo apt-get install -y \
    ca-certificates curl wget gnupg lsb-release \
    git openssh-server \
    build-essential pkg-config \
    python3 python3-venv python3-pip python3-dev \
    poppler-utils \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
    tmux jq

  # Python 3.11 for optional TensorFlow / Paddle venvs (best-effort).
  if ! command -v python3.11 >/dev/null 2>&1; then
    if apt-cache show python3.11 >/dev/null 2>&1; then
      sudo apt-get install -y python3.11 python3.11-venv python3.11-dev || true
    fi
  fi
}

install_vscode_cli() {
  log "VS Code CLI (Remote SSH installs the server on first connect)"
  if command -v code >/dev/null 2>&1; then
    echo "code already installed: $(code --version | head -1)"
    return 0
  fi

  if ! command -v wget >/dev/null 2>&1; then
    die "wget required to install VS Code"
  fi

  tmp_key="$(mktemp)"
  wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor | sudo tee "$tmp_key" >/dev/null
  sudo install -D -o root -g root -m 644 "$tmp_key" /usr/share/keyrings/packages.microsoft.gpg
  rm -f "$tmp_key"

  echo "deb [arch=amd64,arm64,armhf signed-by=/usr/share/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" \
    | sudo tee /etc/apt/sources.list.d/vscode.list >/dev/null

  sudo apt-get update -qq
  sudo apt-get install -y code || {
    echo "WARN: VS Code package install failed — you can still use Remote SSH from your laptop." >&2
    return 0
  }
  echo "Installed: $(code --version | head -1)"
}

install_github_cli() {
  log "GitHub CLI (gh)"
  if command -v gh >/dev/null 2>&1; then
    echo "gh already installed: $(gh --version | head -1)"
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    die "curl required to install gh"
  fi

  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg status=none
  sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y gh
  echo "Installed: $(gh --version | head -1)"
}

ensure_github_auth() {
  log "GitHub authentication"
  if gh auth status >/dev/null 2>&1; then
    gh auth status
    return 0
  fi

  echo ""
  echo "GitHub is not authenticated on this machine yet."
  echo "Choose one:"
  echo "  1) gh auth login          (HTTPS — recommended for private repos)"
  echo "  2) ssh-keygen + add key   (SSH — https://github.com/settings/keys)"
  echo ""
  if [[ -t 0 ]]; then
    read -r -p "Run 'gh auth login' now? [Y/n] " reply
    reply="${reply:-Y}"
    if [[ "$reply" =~ ^[Yy]$ ]]; then
      gh auth login
      gh auth setup-git || true
      return 0
    fi
  fi
  echo "Skipping interactive gh login. Clone may fail for private repos until you authenticate."
}

clone_or_update_repo() {
  log "Clone or update repository → $REPO_DIR"
  if [[ -d "$REPO_DIR/.git" ]]; then
    echo "Repo exists — fetching latest"
    git -C "$REPO_DIR" fetch --all --prune
    git -C "$REPO_DIR" pull --ff-only || echo "WARN: pull failed — resolve manually in $REPO_DIR" >&2
    return 0
  fi

  if [[ -e "$REPO_DIR" ]]; then
    die "$REPO_DIR exists but is not a git repository"
  fi

  mkdir -p "$(dirname "$REPO_DIR")"
  local slug="${REPO_URL#https://github.com/}"
  slug="${slug%.git}"
  if gh auth status >/dev/null 2>&1; then
    gh repo clone "$slug" "$REPO_DIR" -- --recurse-submodules 2>/dev/null \
      || git clone --recurse-submodules "$REPO_URL" "$REPO_DIR"
  else
    git clone --recurse-submodules "$REPO_URL" "$REPO_DIR"
  fi
}

pick_python() {
  if command -v python3.11 >/dev/null 2>&1; then
    echo python3.11
  elif command -v python3.12 >/dev/null 2>&1; then
    echo python3.12
  else
    echo python3
  fi
}

setup_gpu_venv() {
  local root="$1"
  local inf="$root/services/inference"
  local py venv

  [[ -d "$inf" ]] || die "Missing $inf — run without --skip-clone or set REPO_DIR"

  log "GPU Python environment ($inf/.venv)"
  py="$(pick_python)"
  echo "Using interpreter: $($py --version)"

  venv="$inf/.venv"
  if [[ ! -d "$venv" ]]; then
    "$py" -m venv "$venv"
  fi

  # shellcheck disable=SC1091
  source "$venv/bin/activate"
  pip install -U pip wheel setuptools
  pip install -r "$inf/requirements-gpu.txt"

  if [[ ! -f "$inf/.env" ]]; then
    cp "$inf/.env.example" "$inf/.env"
    echo "Created $inf/.env from .env.example"
  else
    echo "Keeping existing $inf/.env"
  fi

  log "Patch RACE defaults in .env (non-destructive)"
  python3 - <<'PY' "$inf/.env"
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
replacements = {
    r"^RUN_MODE=.*": "RUN_MODE=real",
    r"^DEVICE=.*": "DEVICE=auto",
    r"^API_HOST=.*": "API_HOST=127.0.0.1",
    r"^API_PORT=.*": "API_PORT=8000",
}
for pattern, value in replacements.items():
    if re.search(pattern, text, flags=re.M):
        text = re.sub(pattern, value, text, count=1, flags=re.M)
    else:
        text = text.rstrip() + f"\n{value}\n"
path.write_text(text, encoding="utf-8")
print(f"Updated {path} for RACE (RUN_MODE=real, DEVICE=auto)")
PY

  log "CUDA smoke test"
  python - <<'PY'
import torch
print("torch", torch.__version__)
print("cuda available", torch.cuda.is_available())
if torch.cuda.is_available():
    print("device", torch.cuda.get_device_name(0))
    print("vram_gb", round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1))
else:
    print("WARN: CUDA not visible — check nvidia-smi and NVIDIA drivers on RACE")
PY

  log "Prefetch core model weights (optional — may take a few minutes)"
  (cd "$inf" && python scripts/prefetch_architect.py) || echo "WARN: prefetch_architect failed (retry later)" >&2
  (cd "$inf" && python scripts/prefetch_layout.py) || echo "WARN: prefetch_layout failed (retry later)" >&2

  deactivate || true
}

print_next_steps() {
  local root="$1"
  cat <<EOF

================================================================================
HighLife RACE setup complete.

Repo:        $root
Python venv: $root/services/inference/.venv
Config:      $root/services/inference/.env

1) Edit Supabase credentials (service role — never in browser):
     nano $root/services/inference/.env
   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for your cloud project.

2) Start inference API + job worker:
     $root/scripts/race-services.sh start
     $root/scripts/race-services.sh status

3) VS Code from your laptop:
   - Install "Remote - SSH" extension
   - Connect to this RACE host
   - Open folder: $root
   - Python interpreter: $root/services/inference/.venv/bin/python

4) Optional SSH tunnel (laptop browser → RACE inference):
     ssh -L 8000:127.0.0.1:8000 USER@RACE_HOST
   Laptop apps/web/.env.local:
     NEXT_PUBLIC_INFERENCE_API_URL=http://127.0.0.1:8000

Docs: $root/docs/RACE-UBUNTU.md
================================================================================
EOF
}

main() {
  require_linux

  local root=""
  if root="$(repo_root_from_script)"; then
    echo "Running from repo: $root"
    SKIP_CLONE=1
  fi

  if [[ "$SKIP_APT" -eq 0 ]]; then
    install_apt_packages
    sudo systemctl enable --now ssh 2>/dev/null || true
  fi

  if [[ "$SKIP_VSCODE" -eq 0 ]]; then
    install_vscode_cli
  fi

  if [[ "$SKIP_GH" -eq 0 ]]; then
    install_github_cli
    ensure_github_auth
  fi

  if [[ "$SKIP_CLONE" -eq 0 ]]; then
    clone_or_update_repo
    root="$REPO_DIR"
  fi

  [[ -n "$root" ]] || root="$(repo_root_from_script)" || die "Could not locate repo root"

  if [[ "$SKIP_GPU" -eq 0 ]]; then
    if command -v nvidia-smi >/dev/null 2>&1; then
      log "GPU"
      nvidia-smi || true
    else
      echo "WARN: nvidia-smi not found — continuing CPU-only venv install" >&2
    fi
    setup_gpu_venv "$root"
  fi

  chmod +x "$root/scripts/race-services.sh" "$root/scripts/race-train.sh" "$root/scripts/race-enable-gpu.sh" 2>/dev/null || true
  if [[ -f "$root/scripts/race-enable-gpu.sh" ]]; then
    REPO="$root" "$root/scripts/race-enable-gpu.sh" || true
  fi
  print_next_steps "$root"
}

main "$@"
