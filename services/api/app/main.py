from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import init_db
from app.errors import register_error_handlers
from app.routers import analysis, detect, plans, projects

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="HighLife Floor-Plan Intelligence API",
    version="0.1.0",
    description="Local-first extraction foundation. No cloud vision. CV providers are not implemented yet.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)
app.include_router(projects.router)
app.include_router(plans.router)
app.include_router(analysis.router)
app.include_router(detect.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "floor-plan-api"}
