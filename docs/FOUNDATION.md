# Floor-plan intelligence foundation

Local-first extraction layer (not compliance). Frontend stays Next.js; models stay behind FastAPI. Existing scale calibration in the viewer is unchanged.

## What is implemented (Prompts 00–03)

- Canonical `FloorPlanSceneGraph` in TypeScript and Pydantic.
- FastAPI in `services/api` (port **8001**): projects, upload, PyMuPDF raster at 350 DPI, mock scene graph.
- Editable canvas overlays (Konva): pan/zoom raster stays an HTML image; annotations use original-image pixels, layers, draw tools, undo/redo, inspector.

## Suggested next prompts (do not skip to models)

04 calibration → scene graph · 05 main-plan crop · 09 rooms · 13 measurements · 15 review · 16 demo · then OCR/walls/graph/openings/pipeline/export/providers/eval.
