# RACE Ubuntu setup

RMIT **RACE** is a private GPU workstation. This repo keeps heavy ML on RACE and the Next.js UI on your laptop. See [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Recommended GPU

| Choice | VRAM | When |
|--------|------|------|
| **A10G** | 24 GB | Best default — train + infer on one station |
| **L4** | 24 GB | Inference-heavy, occasional fine-tunes |
| **T4** | 16 GB | Budget; stick to `yolov8n/s`, batch 2, lower `YOLO_IMGSZ` |

System RAM: **32 GB** minimum, **64 GB** for large tile datasets.

## One-time bootstrap (fresh Ubuntu VM)

From any shell on RACE:

```bash
curl -fsSL https://raw.githubusercontent.com/gausubash/HighLifeAIWeb/main/scripts/setup-race.sh | bash
```

Or after you already have the repo:

```bash
cd ~/HighLifeAIWeb
chmod +x scripts/setup-race.sh scripts/race-services.sh scripts/race-train.sh
./scripts/setup-race.sh
```

The script installs:

- Git, build tools, Poppler (PDF → image), OpenCV system libs
- **OpenSSH** (for VS Code Remote SSH)
- **GitHub CLI** (`gh`) and prompts for `gh auth login` if needed
- **VS Code CLI** (`code`) — Remote SSH pulls the server on first connect
- Clone/update `~/HighLifeAIWeb`
- GPU Python venv at `services/inference/.venv` (`requirements-gpu.txt`)
- Starter `.env` with `RUN_MODE=real`, `DEVICE=cuda`

### Skip flags

```bash
./scripts/setup-race.sh --skip-apt --skip-vscode   # repo + GPU only
./scripts/setup-race.sh --skip-gpu                 # OS + clone only
REPO_DIR=/data/HighLifeAIWeb ./scripts/setup-race.sh
```

## Configure secrets

Edit `services/inference/.env`:

```bash
RUN_MODE=real
DEVICE=cuda

SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # worker only — never in browser

API_HOST=127.0.0.1
API_PORT=8000
```

Do **not** bind the API to `0.0.0.0` on a public IP. Use `127.0.0.1` and an SSH tunnel from your laptop.

## Daily use

```bash
cd ~/HighLifeAIWeb
./scripts/race-services.sh start    # uvicorn + job worker
./scripts/race-services.sh status
./scripts/race-services.sh logs
./scripts/race-services.sh stop
```

| Service | Purpose |
|---------|---------|
| Inference API (`127.0.0.1:8000`) | Detect, OCR, Model Studio train/tile/infer |
| Worker | Claims analysis jobs from Supabase, runs CUDA pipeline |

## VS Code from your laptop

1. Install **Remote - SSH** in VS Code on your laptop.
2. Add RACE to `~/.ssh/config` (host, user, key).
3. **Connect to Host…** → open `~/HighLifeAIWeb`.
4. Select Python interpreter: `services/inference/.venv/bin/python`.

Optional tunnel so the laptop UI talks to RACE inference:

```bash
ssh -L 8000:127.0.0.1:8000 user@race-host
```

Laptop `apps/web/.env.local`:

```bash
NEXT_PUBLIC_INFERENCE_API_URL=http://127.0.0.1:8000
```

## CLI training (optional)

Model Studio fine-tunes go through the inference API. For a standalone YOLO run:

```bash
./scripts/race-train.sh /path/to/data.yaml yolov8n-seg.pt 50
```

Upload `artifacts/<run>/best.pt` to Supabase Storage per [`services/training/README.md`](../services/training/README.md).

## Manual smoke test

```bash
cd services/inference
source .venv/bin/activate
uvicorn app.api:app --host 127.0.0.1 --port 8000
curl -s http://127.0.0.1:8000/health | python3 -m json.tool
pytest tests/ -v
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `cuda available False` | Run `nvidia-smi`; ask RACE admin to install NVIDIA drivers |
| Private clone fails | `gh auth login` or add SSH key to GitHub |
| Out of VRAM on T4 | Lower Studio batch to 2, use `yolov8n-seg`, set `YOLO_IMGSZ=640` |
| Worker idle | Check `SUPABASE_*` in `.env` and queued jobs in Supabase |
