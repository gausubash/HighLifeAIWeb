# @highlife/web

Next.js frontend for the urban residential floor-plan analysis platform.

## Local development (mock mode)

No Supabase or GPU required:

```bash
npm run dev
```

Open http://localhost:3000 — projects, PDF upload, analysis status, and plan review viewer run against in-memory mock data.

## Routes

| Path | Description |
|------|-------------|
| `/projects` | Project list |
| `/projects/new` | Create project |
| `/projects/[id]` | Project dashboard |
| `/projects/[id]/analyses/[analysisId]` | Analysis status |
| `/projects/[id]/analyses/[analysisId]/review` | Plan review viewer |

Auth routes (`/auth/sign-in`, `/auth/sign-up`) added in Phase 3.
