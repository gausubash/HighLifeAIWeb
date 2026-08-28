# Frontend only — Next.js

HighLife UI for marketing, sign-in, projects, uploads, and plan review.

**No GPU / no ML runtime here.** Heavy train/infer runs on **RACE** (private RMIT AWS GPU workstation). The browser talks to the shared data plane (Supabase), not to RACE. See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

```bash
# from repo root
npm install
npm run dev
```

Optional local floor-plan API: `NEXT_PUBLIC_FLOOR_PLAN_API_URL=http://127.0.0.1:8001` (`src/lib/api/floorPlanClient.ts`). Auth, projects, and plan files persist to Supabase. Page rasters also cache in IndexedDB for local Detect.

Optional inference: `NEXT_PUBLIC_INFERENCE_API_URL=http://127.0.0.1:8000` (`src/lib/api/inferenceClient.ts`). That URL is for **this PC’s** uvicorn server only — not a public RACE endpoint.
