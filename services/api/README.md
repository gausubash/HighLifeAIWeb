# Floor-plan intelligence API (local-first)

Python FastAPI service for projects, plan uploads, analysis runs, and the canonical `FloorPlanSceneGraph`. **No computer vision yet** — analysis runs return schema-valid mock geometry so the frontend can be wired immediately.

This is separate from `services/inference` (RACE/GPU job contract). The browser talks to this API for extraction-foundation data; it must not load ML weights.

## Local development

```bash
cd services/api
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env   # or: cp .env.example .env

pytest tests/ -v
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

- Health: `GET http://127.0.0.1:8001/health`
- OpenAPI: `http://127.0.0.1:8001/docs`
PDF pages are rasterised with PyMuPDF at `RENDER_DPI` (default **350**). A lower-resolution PNG is stored for thumbnails only; the working raster is never replaced.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/projects` | `{ "name": "..." }` |
| GET | `/api/projects/{project_id}` | |
| POST | `/api/plans/upload` | multipart: `projectId`, `file` — stores original and rasters pages |
| GET | `/api/plans/{plan_id}` | |
| GET | `/api/plans/{plan_id}/pages` | page metadata + image URLs |
| GET | `/api/pages/{page_id}/image?variant=original\|preview` | PNG; preview is thumbnail-only |
| POST | `/api/plans/{plan_id}/analysis-runs` | `{ "pageId", "profile" }` |
| GET | `/api/analysis-runs/{run_id}` | |
| GET | `/api/analysis-runs/{run_id}/scene-graph` | Canonical graph |

Errors:

```json
{ "error": { "code": "STRING_CODE", "message": "Human-readable message", "details": {} } }
```

## Example scene graph

See `examples/apartment_two_rooms.json` (written by tests from the mock builder).
