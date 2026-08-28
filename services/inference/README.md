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

The plan viewer calls `POST /v1/detect`. Layout cropping and the Architect fixture model are **off** by default. Walls run on the **full page** (MitUNet). Set `USE_LAYOUT_DETECTOR=true` / `YOLO_WEIGHTS` and `USE_ROOM_DETECTOR=true` / `YOLO_ROOM_WEIGHTS` when you have those models.

Set `WALL_BACKEND=yolo` for oriented wall boxes. Legacy MMDet checkpoints (`cascade_swin`, `faster_rcnn`, `retinanet`) download from [Google Drive weights](https://drive.google.com/drive/folders/1MgW3Qo-8K4OrHi4ebvYd-81cTqQxwLgz) into `models/`.

### Roboflow floorplan-iculh (local ONNX)

Universe models are not a public `.pt` download. Prefetch caches an ONNX under `models/roboflow_cache/` (uses your API key once), then Detect runs on-device via Ultralytics:

```bash
# needs Python 3.10–3.12 (.venv-tf) + inference package
.venv-tf\Scripts\python.exe -m pip install inference
.venv-tf\Scripts\python.exe scripts/prefetch_roboflow.py
```

Then pick **Roboflow floorplan-iculh/1** in Detect (`wall:roboflow`). Cloud API remains a fallback if the ONNX cache is missing.

First detect may download MitUNet weights. Optional cache: `models/mitunet_walls.pth`.

```bash
cd services/inference
.venv\Scripts\activate
uvicorn app.api:app --reload --host 127.0.0.1 --port 8000
```

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Mode, device, `yolo_ready`, `wall_ready`, `room_ready` |
| POST | `/v1/detect` | Walls on the full page (layout/Architect optional) |
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
