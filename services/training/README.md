# Training (RACE GPU workstation only)

This package is for **model training** on RMIT **RACE**: a private, customisable AWS virtual station with GPU — not a public training API.

## Where it runs

| Machine | Use |
|---------|-----|
| Laptop (no GPU) | Prefer Model Studio (`services/inference` + `.venv`) for small fine-tunes. |
| RACE GPU station | Log in like a remote PC; train; push weights to shared AWS Storage. |

## Intended flow

1. Annotations / datasets live in **AWS object storage** (sync or download onto the station).
2. Train on RACE (`DEVICE=cuda`).
3. Export checkpoint + metadata (dataset version, commit SHA, metrics) **to Storage**.
4. Register the artifact in the model registry (`configs/models.yaml` + DB row).
5. The **inference worker** on RACE loads those weights for `RUN_MODE=real` and writes job results back to the data plane (browser never calls RACE).

## Train CLI (Phase 6)

```bash
cd services/training
# Use the inference CUDA venv (ultralytics + torch)
python -m train --data /path/to/data.yaml --model yolov8n-seg.pt --epochs 50 --device cuda --out artifacts
```

Then upload `artifacts/<run>/best.pt` + `meta.json` to Supabase Storage.

## Worker (Phases 6 + 9)

```bash
cd services/inference
# Local file queue (laptop / CI)
python -m app.worker --enqueue-demo
python -m app.worker --once --batch-size 2

# RACE with Supabase service role in .env
python -m app.worker --device cuda --poll-interval 10 --batch-size 2 --lease-seconds 180
python -m app.process_one_job --analysis-id <uuid> --enqueue
```

Keep secrets and large weights out of git. Service-role credentials stay on the station only.
