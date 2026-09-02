# Inference Service (Backend)

Python analysis pipeline + optional local FastAPI. On **RACE** (RMIT’s private AWS GPU workstation), the primary mode is a **worker** that pulls jobs from shared AWS/Supabase storage — not a public API the browser calls.

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

## Setup (laptop, no GPU)

```bash
cd services/inference
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
```

### floorData / TensorFlow (Model Studio)

The main `.venv` may be Python 3.13+ (no TensorFlow wheels). Studio fine-tunes DeepLab/UNet via a **separate** venv:

```bash
py -3.11 -m venv .venv-tf
.venv-tf\Scripts\python.exe -m pip install -r requirements-tensorflow.txt
```

Keep uvicorn on `.venv`; floorData train jobs spawn `.venv-tf` automatically (override with `TENSORFLOW_PYTHON`).

Copy `.env.example` to `.env` and keep `RUN_MODE=mock` / `DEVICE=cpu`.

## Page detect overlay (CPU OK)

The plan viewer calls `POST /v1/detect` with a **task-specific** model token:

| Token | Task | Weights |
|-------|------|---------|
| `wall:mitunet` (default) | Wall segmentation | `models/mitunet_walls.pth` |
| `wall:roboflow` | ArchVision wall instances | Roboflow `archvision_wall_detect/1` (`ROBOFLOW_API_KEY`) |
| `room:architect` | Room types | `models/architect_floorplan.pt` |
| `room:roboflow` | Office room masks | Roboflow `floorplan-9fxye/1` (`ROBOFLOW_API_KEY`) |
| `structural:roboflow-seg` | Walls, doors, windows (instance seg) | Roboflow `floorplan-segmentation-imdze/4` |
| `opening:architect` | Doors / windows (Architect YOLO) | `models/architect_floorplan.pt` |
| `object:architect` | Stairs / lifts | same Architect checkpoint |
| `layout:greenmap` | Sheet layout (Layout tab) | `yolo_layout.pt` / `YOLO_WEIGHTS` |
| `studio:<uuid>` | Fine-tuned Studio model | Model Studio export |

Wall Detect is **MitUNet** (`wall:mitunet`) or **ArchVision Roboflow** (`wall:roboflow`).

First wall detect may download MitUNet weights. Optional cache: `models/mitunet_walls.pth`.

```bash
cd services/inference
.venv\Scripts\activate
uvicorn app.api:app --reload --host 127.0.0.1 --port 8000
```

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Mode, device, `yolo_ready`, `wall_ready`, `room_ready` |
| POST | `/v1/detect` | Task-specific overlay (walls / rooms / objects / layout) |
| POST | `/v1/analyze` | Run one analysis (mock fixture today) |

```bash
curl -s http://127.0.0.1:8000/health
```

## RACE GPU station (later)

RACE is a customisable virtual station with GPU — treat it like a remote PC:

1. Log in (RDP / SSH), clone the repo, install CUDA + `requirements-gpu.txt`.
2. Configure service-role access to Supabase / Storage (outbound only).
3. Run the **worker** to claim queued analyses, download PDFs, write results.
4. Use localhost FastAPI only if you want to debug a single run on the station.

```bash
# Queue worker stubs (Phase 6)
python -m app.process_one_job --analysis-id ID --device cuda
python -m app.worker --device cuda
```

## CLI

```bash
python -m app.predict --mode mock --device cpu
pytest tests/ -v
```

## Run modes

| RUN_MODE | Behaviour |
|----------|-----------|
| `mock`   | Returns deterministic fixture output |
| `real`   | Runs real pipeline (CPU or CUDA) |

GPU / RACE is **not required** for mock mode, tests, or frontend development.
