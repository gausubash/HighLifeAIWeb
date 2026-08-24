# Frontend only — Next.js

HighLife UI for marketing, sign-in, projects, uploads, and plan review.

**No GPU / no ML runtime here.** Heavy train/infer runs on **RACE** (private RMIT AWS GPU workstation). The browser talks to the shared data plane (Supabase), not to RACE. See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

```bash
# from repo root
npm install
npm run dev
```

Optional local floor-plan API: `NEXT_PUBLIC_FLOOR_PLAN_API_URL=http://127.0.0.1:8001` (`src/lib/api/floorPlanClient.ts`). The workspace viewer and scale calibration still use localStorage/IndexedDB until later prompts wire this client.

Optional inference mock: `NEXT_PUBLIC_INFERENCE_API_URL=http://127.0.0.1:8000` (`src/lib/api/inferenceClient.ts`). That URL is for **this PC’s** mock server only — not a public RACE endpoint.
