# Urban Compliance Platform — Inference Service

Python pipeline for floor-plan analysis. Supports mock, CPU, and CUDA modes.

## Setup

```bash
cd services/inference
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
```

Copy `.env.example` to `.env` and set `RUN_MODE=mock` for local development.

## Commands

```bash
# Mock prediction (no GPU, no models)
python -m app.predict --mode mock --device cpu

# Run tests
pytest tests/ -v

# GPU worker (Phase 6 — requires Supabase)
python -m app.process_one_job --analysis-id ID --device cuda
python -m app.worker --device cuda
```

## Run modes

| RUN_MODE | Behaviour |
|----------|-----------|
| `mock`   | Returns deterministic fixture output |
| `real`   | Runs real pipeline (CPU or CUDA) |

GPU VM is **not required** for mock mode or tests.
