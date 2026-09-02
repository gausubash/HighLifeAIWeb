# HighLife — Frontend vs Backend Separation

This repo keeps **UI development** and **GPU ML work** on different machines. The browser never loads models or CUDA.

## What RACE is (and is not)

**RMIT RACE** is a dedicated AWS service for RMIT: think of it as a **private virtual workstation** you customise (Ubuntu or Windows) with **GPU access**.

| RACE is | RACE is not |
|---------|-------------|
| A remote desktop / SSH GPU station | A public cloud API product |
| Where you train and run heavy inference | Something the browser should call directly |
| Customisable like your own PC (venv, CUDA, clones) | Exposed on the public internet by default |

The laptop and RACE **do not talk to each other over a public Inference URL**. They share state through an **AWS-backed data plane** (Supabase Postgres + Storage, or equivalent).

## Roles

| Layer | Path | Runs on | Responsibility |
|-------|------|---------|----------------|
| **Frontend** | `apps/web` | Your laptop (no GPU) | Marketing, auth UI, projects, PDF upload UX, plan viewer. Talks only to the data plane (and optional local mock API). |
| **Shared contracts** | `packages/shared-types` | Build-time (TS) | Types for projects, analyses, geometry, compliance. Keep in sync with Python schemas. |
| **Inference worker / pipeline** | `services/inference` | RACE GPU workstation (or local mock) | Claim jobs, download PDFs from storage, run CV/AI, write results back. FastAPI is for **local** testing or **localhost-on-RACE** — not a public RACE endpoint. |
| **Training** | `services/training` | RACE GPU workstation only | Dataset prep, training, export weights into shared storage. |
| **Data plane** | Supabase (AWS-backed) | Managed | Auth, projects, PDFs, job queue, results, weight metadata. The bridge between laptop and RACE. |

## Target topology

```
┌──────────────────────────┐
│  Laptop (no GPU)         │
│  apps/web                │
│  • upload PDFs           │
│  • create analysis jobs  │
│  • show results          │
└────────────┬─────────────┘
             │  HTTPS to data plane only
             ▼
┌──────────────────────────────────────────────────────────────┐
│  AWS data plane (Supabase or equivalent)                     │
│  • Postgres: projects, analyses, jobs, results               │
│  • Storage: PDFs, pages, reports, trained weights            │
│  • Auth: users + service role for the RACE worker            │
└────────────┬─────────────────────────────────────────────────┘
             │  worker polls / claims jobs (outbound from RACE)
             │  download PDF · run CUDA · upload result
             ▼
┌──────────────────────────────────────────────────────────────┐
│  RACE = private GPU virtual station (Ubuntu / Windows)       │
│  • Not publicly reachable for API calls from the browser     │
│  • You log in (remote desktop / SSH) like a custom PC        │
│  • services/inference worker  (DEVICE=cuda)                  │
│  • services/training          (train → Storage)              │
│  • Optional: uvicorn on localhost for debugging ON the VM    │
└──────────────────────────────────────────────────────────────┘
```

### Why this split

- **Laptop:** UI and contracts without CUDA or weights.
- **RACE:** private GPU station for train + infer; no need for a public API.
- **Shared AWS storage/DB:** the only sync path between the two machines.

## How inference reaches the UI (later)

**Preferred (fits RACE):**

1. User uploads a PDF on the laptop → object **Storage**.
2. Frontend creates an **analysis job** row (`queued`) in Postgres.
3. On RACE, a **worker** (outbound) polls or claims the job, downloads the PDF, runs CUDA inference, writes result + status.
4. Frontend reads status/result via Supabase Realtime or polling.

No inbound port on RACE is required. The workstation only needs outbound access to the data plane.

**Local FastAPI (`uvicorn app.api:app`):**

- Use on the **laptop** for mock/CPU API smoke tests.
- Optionally on **RACE localhost** while you SSH/RDP into the station to debug a single run.
- Do **not** assume the browser on your laptop can reach a public URL on RACE.

Today the web app still uses **localStorage mocks**. `NEXT_PUBLIC_INFERENCE_API_URL` is for **local** mock API only until the job queue exists.

## Environment boundaries

| Variable | Where | Notes |
|----------|-------|--------|
| `NEXT_PUBLIC_SUPABASE_*` | Frontend | Public anon key only |
| `NEXT_PUBLIC_INFERENCE_API_URL` | Frontend | **Local mock** (`http://localhost:8000`) — not a RACE public URL |
| `SUPABASE_SERVICE_ROLE_KEY` | RACE worker / training only | Never in the browser |
| `RUN_MODE` / `DEVICE` | Inference / training | `mock`+`cpu` on laptop; `real`+`cuda` on RACE |
| `API_HOST` / `API_PORT` | Optional local FastAPI | Prefer `127.0.0.1` on RACE if used for debug |

## Local development (this PC, no GPU)

```bash
# Frontend only
npm install && npm run dev

# Optional: mock Inference API on this machine (CPU) — for API contract tests
cd services/inference
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.api:app --reload --host 127.0.0.1 --port 8000
```

## On RACE

See **[`docs/RACE-UBUNTU.md`](RACE-UBUNTU.md)** for the automated Ubuntu bootstrap (`scripts/setup-race.sh`), VS Code Remote SSH, and daily `race-services.sh` workflow.

1. Provision / customise the GPU virtual station (Ubuntu recommended).
2. Run `./scripts/setup-race.sh` (clone, VS Code CLI, GitHub CLI, GPU venv).
3. Configure service-role credentials for Supabase / AWS Storage (secrets stay on the station).
4. Sync or download datasets/weights from Storage.
5. Train via `services/training` or Model Studio; publish checkpoints to Storage.
6. Run the **worker** so it claims jobs from Postgres and writes results. Use localhost FastAPI only if you need interactive debugging on the station.

## Hard rules

- Do **not** import Python ML code or torch into `apps/web`.
- Do **not** treat RACE as a public Inference host for the browser.
- Do **not** commit PDFs, weights, LabelMe dumps, or service-role keys.
- Inference supports assessment; it does **not** replace statutory approval.
