# HighLife AI Web — Urban Residential Floor-Plan Analysis Platform

Production-oriented platform for analysing residential floor-plan PDFs: detect structure, infer units, calculate geometry, and evaluate configurable design-policy rules.

Fresh monorepo built from scratch. Prior research prototypes live in the separate [`highlife`](https://github.com/gausubash/highlife) repository — useful as reference, not as runtime dependency.

## Architecture

```
Browser (Next.js)  →  Supabase (Auth, DB, Storage)  ←  GPU worker (Python, polling)
                              ↓
                     Queued analysis jobs
```

- **Laptop:** frontend development, mock/CPU pipeline, tests
- **GPU VM (RMIT RACE/AWS):** training and CUDA inference only — not required for normal dev

## Repository layout

```
apps/web/              Next.js frontend
services/inference/    Python pipeline + GPU worker
packages/shared-types/ Cross-package TypeScript types
configs/               Dataset splits, model registry
scripts/               Annotation utilities
supabase/migrations/   Database schema (Phase 3)
tests/                 Integration tests
```

## Quick start (local, no GPU)

```bash
# Install Node dependencies
npm install

# Start frontend (mock mode — no Supabase required)
npm run dev
# → http://localhost:3000

# Python inference service
cd services/inference
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate

pip install -r requirements.txt
pytest tests/ -v
python -m app.predict --mode mock --device cpu
```

Copy `.env.example` to `.env` and `services/inference/.env.example` to `services/inference/.env` when connecting Supabase (Phase 3).

## Run modes

| Mode   | `RUN_MODE` | `DEVICE` | Use case                    |
|--------|------------|----------|-----------------------------|
| Mock   | `mock`     | `cpu`    | Local dev, CI, UI testing   |
| CPU    | `real`     | `cpu`    | Real models on laptop       |
| CUDA   | `real`     | `cuda`   | GPU VM inference/training   |

## Development phases

| Phase | Status | Description                              |
|-------|--------|------------------------------------------|
| 1     | ✅      | Monorepo scaffold, CI                    |
| 2     | ✅      | Mock vertical slice (upload → viewer)    |
| 3     | 🔲      | Supabase auth, projects, storage, RLS    |
| 4     | 🔲      | Master annotations, validation, splits   |
| 5     | 🔲      | CPU geometry pipeline                    |
| 6     | 🔲      | GPU worker, training                     |
| 7     | 🔲      | Review UI, exports, reports              |
| 8     | 🔲      | Policy engine (versioned YAML)           |
| 9     | 🔲      | Scalability (retries, heartbeat, batch)  |

## Security

- Never commit PDFs, LabelMe annotations, credentials, or model weights
- Service-role key is server/worker only — never in browser code
- GPU VM is not publicly exposed in v1

## Disclaimer

This tool assists professional review. It does **not** provide statutory approval. Uncertain geometry yields `uncertain` compliance results — never silent pass/fail.
