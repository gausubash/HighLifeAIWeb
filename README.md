# HighLife AI Web — Urban Residential Floor-Plan Analysis Platform

Production-oriented platform for analysing residential floor-plan PDFs: detect structure, infer units, calculate geometry, and evaluate configurable design-policy rules.

Fresh monorepo built from scratch. Prior research prototypes live in the separate [`highlife`](https://github.com/gausubash/highlife) repository — useful as reference, not as runtime dependency.

**Frontend vs backend:** see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Architecture

```
Laptop (no GPU)                         RACE = private GPU virtual station
apps/web  ──HTTPS──►  AWS data plane  ◄── worker (outbound poll)
                      (Supabase DB + Storage)
                            ▲
                            └── training on RACE writes weights to Storage
```

RACE is an RMIT-dedicated AWS **workstation with GPU**, not a public API. The browser never calls RACE directly; both machines sync through shared storage and the job queue.

| Layer | Path | Machine |
|-------|------|---------|
| Frontend | `apps/web` | This PC (no GPU) |
| Floor-plan API | `services/api` | This PC — projects, uploads, scene graph (no CV yet) |
| Inference worker / API | `services/inference` | Local mock **or** RACE (worker) |
| Training | `services/training` | RACE GPU station only |
| Types | `packages/shared-types` | Shared contracts including `FloorPlanSceneGraph` |

## Repository layout

```
apps/web/              Next.js frontend (UI only — no models)
services/api/          FastAPI floor-plan intelligence (local SQLite + files)
services/inference/    FastAPI inference + pipeline + GPU worker
services/training/     Training jobs (RACE GPU; placeholder)
packages/shared-types/ Cross-package TypeScript types
configs/               Dataset splits, model registry
scripts/               Annotation utilities
docs/ARCHITECTURE.md   FE / BE / RACE AWS topology
docs/FOUNDATION.md     Extraction foundation (scene graph)
supabase/migrations/   Database schema (Phase 3)
tests/                 Integration tests
```

## Quick start (local, no GPU)

```bash
# Frontend
npm install
npm run dev
# → http://localhost:3000

# Floor-plan intelligence API (local SQLite — mock scene graph, no CV)
cd services/api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pytest tests/ -v
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
# → http://127.0.0.1:8001/health
# → http://127.0.0.1:8001/docs

# Optional: Inference API mock (GPU/RACE contract — separate service)
cd services/inference
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.api:app --reload --port 8000
```

Copy `.env.example` to `.env` and `apps/web/.env.local`. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the HighLife Supabase project. Detect still uses `NEXT_PUBLIC_INFERENCE_API_URL=http://127.0.0.1:8000` on this PC. Set `NEXT_PUBLIC_FLOOR_PLAN_API_URL=http://127.0.0.1:8001` when wiring the extraction API.

**Model Studio** (`/studio`): upload a YOLO dataset ZIP, fine-tune detect or segment on this PC (uvicorn must be running), save weights to Supabase, then run inference or activate a model for the plan viewer.

## Run modes

| Mode   | `RUN_MODE` | `DEVICE` | Use case                    |
|--------|------------|----------|-----------------------------|
| Mock   | `mock`     | `cpu`    | Local dev, CI, UI testing   |
| CPU    | `real`     | `cpu`    | Real models on laptop       |
| CUDA   | `real`     | `cuda`   | RACE AWS GPU inference/train|

## Development phases

| Phase | Status | Description                              |
|-------|--------|------------------------------------------|
| 1     | ✅      | Monorepo scaffold, CI                    |
| 2     | ✅      | Mock vertical slice (upload → viewer)    |
| 3     | ✅      | Supabase auth, projects, storage, RLS    |
| 4     | ✅      | Master annotations, validation, splits   |
| 5     | ✅      | CPU geometry pipeline                    |
| 6     | ✅      | RACE GPU worker + training (job queue via data plane) |
| 7     | ✅      | Review UI, exports, reports              |
| 8     | ✅      | Policy engine (versioned YAML)           |
| 9     | ✅      | Scalability (retries, heartbeat, batch)  |

## Security

- Never commit PDFs, LabelMe annotations, credentials, or model weights
- Service-role key is worker/station only — never in browser code
- RACE is a private GPU station — do not expose an inbound Inference API to the public internet

## Disclaimer

This tool assists professional review. It does **not** provide statutory approval. Uncertain geometry yields `uncertain` compliance results — never silent pass/fail.
