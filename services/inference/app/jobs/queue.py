"""Analysis job queue — local file backend + Supabase data plane (Phases 6 + 9)."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

INFERENCE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOCAL_QUEUE = INFERENCE_ROOT / ".data" / "job_queue"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None = None) -> str:
    return (dt or _utcnow()).isoformat().replace("+00:00", "Z")


@dataclass
class AnalysisJob:
    id: str
    analysis_id: str
    owner_id: str = "local"
    status: str = "queued"  # queued | running | completed | failed | dead
    attempt: int = 0
    max_attempts: int = 3
    payload: dict[str, Any] = field(default_factory=dict)
    storage_path: str | None = None
    claimed_by: str | None = None
    claimed_at: str | None = None
    heartbeat_at: str | None = None
    lease_expires_at: str | None = None
    error: str | None = None
    last_error: str | None = None
    created_at: str = field(default_factory=_iso)
    started_at: str | None = None
    finished_at: str | None = None
    result: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AnalysisJob:
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in data.items() if k in known})


class LocalJobQueue:
    """Filesystem queue for laptop/CI without Supabase."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root or os.environ.get("HIGHLIFE_JOB_QUEUE_DIR") or DEFAULT_LOCAL_QUEUE)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _path(self, job_id: str) -> Path:
        return self.root / f"{job_id}.json"

    def _read(self, path: Path) -> AnalysisJob:
        return AnalysisJob.from_dict(json.loads(path.read_text(encoding="utf-8")))

    def _write(self, job: AnalysisJob) -> None:
        self._path(job.id).write_text(json.dumps(job.to_dict(), indent=2), encoding="utf-8")

    def enqueue(
        self,
        *,
        analysis_id: str,
        payload: dict[str, Any] | None = None,
        storage_path: str | None = None,
        owner_id: str = "local",
        max_attempts: int = 3,
    ) -> AnalysisJob:
        job = AnalysisJob(
            id=str(uuid.uuid4()),
            analysis_id=analysis_id,
            owner_id=owner_id,
            payload=dict(payload or {}),
            storage_path=storage_path,
            max_attempts=max_attempts,
        )
        with self._lock:
            self._write(job)
        return job

    def list_jobs(self, status: str | None = None) -> list[AnalysisJob]:
        items: list[AnalysisJob] = []
        for path in self.root.glob("*.json"):
            try:
                job = self._read(path)
            except (OSError, json.JSONDecodeError):
                continue
            if status and job.status != status:
                continue
            items.append(job)
        items.sort(key=lambda j: j.created_at)
        return items

    def get(self, job_id: str) -> AnalysisJob | None:
        path = self._path(job_id)
        if not path.is_file():
            return None
        return self._read(path)

    def reclaim_expired(self) -> int:
        now = _utcnow()
        n = 0
        with self._lock:
            for job in self.list_jobs(status="running"):
                if not job.lease_expires_at:
                    continue
                try:
                    exp = datetime.fromisoformat(job.lease_expires_at.replace("Z", "+00:00"))
                except ValueError:
                    continue
                if exp <= now:
                    job.status = "queued"
                    job.claimed_by = None
                    job.lease_expires_at = None
                    job.last_error = "lease_expired"
                    self._write(job)
                    n += 1
        return n

    def claim_batch(
        self,
        *,
        worker_id: str,
        batch_size: int = 1,
        lease_seconds: int = 120,
    ) -> list[AnalysisJob]:
        self.reclaim_expired()
        claimed: list[AnalysisJob] = []
        with self._lock:
            for job in self.list_jobs(status="queued"):
                if len(claimed) >= max(1, batch_size):
                    break
                now = _utcnow()
                job.status = "running"
                job.attempt += 1
                job.claimed_by = worker_id
                job.claimed_at = _iso(now)
                job.heartbeat_at = _iso(now)
                job.lease_expires_at = _iso(now + timedelta(seconds=lease_seconds))
                job.started_at = job.started_at or _iso(now)
                job.error = None
                self._write(job)
                claimed.append(job)
        return claimed

    def heartbeat(self, job_id: str, *, worker_id: str, lease_seconds: int = 120) -> bool:
        with self._lock:
            job = self.get(job_id)
            if not job or job.status != "running" or job.claimed_by != worker_id:
                return False
            now = _utcnow()
            job.heartbeat_at = _iso(now)
            job.lease_expires_at = _iso(now + timedelta(seconds=lease_seconds))
            self._write(job)
            return True

    def complete(self, job_id: str, *, result: dict[str, Any] | None = None) -> AnalysisJob:
        with self._lock:
            job = self.get(job_id)
            if not job:
                raise KeyError(job_id)
            job.status = "completed"
            job.result = result
            job.finished_at = _iso()
            job.lease_expires_at = None
            job.error = None
            self._write(job)
            return job

    def fail(self, job_id: str, *, error: str) -> AnalysisJob:
        with self._lock:
            job = self.get(job_id)
            if not job:
                raise KeyError(job_id)
            job.last_error = error
            job.error = error
            if job.attempt >= job.max_attempts:
                job.status = "dead"
                job.finished_at = _iso()
                job.lease_expires_at = None
            else:
                job.status = "queued"
                job.claimed_by = None
                job.lease_expires_at = None
            self._write(job)
            return job


@dataclass(frozen=True)
class ServiceAuth:
    url: str
    service_role_key: str

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.service_role_key}",
            "apikey": self.service_role_key,
            "Content-Type": "application/json",
        }


class SupabaseJobQueue:
    """Supabase REST queue using analysis_jobs table (Phases 6 + 9 columns)."""

    def __init__(self, auth: ServiceAuth) -> None:
        self.auth = auth

    def _get(self, params: str) -> list[dict]:
        res = httpx.get(
            f"{self.auth.url}/rest/v1/analysis_jobs?{params}",
            headers={**self.auth.headers, "Accept": "application/json"},
            timeout=60.0,
        )
        res.raise_for_status()
        data = res.json()
        return data if isinstance(data, list) else []

    def _patch(self, job_id: str, body: dict) -> None:
        res = httpx.patch(
            f"{self.auth.url}/rest/v1/analysis_jobs?id=eq.{job_id}",
            headers={**self.auth.headers, "Prefer": "return=minimal"},
            json=body,
            timeout=60.0,
        )
        res.raise_for_status()

    def reclaim_expired(self) -> int:
        now = _iso()
        rows = self._get(
            "status=eq.running&lease_expires_at=lt."
            + now
            + "&select=id,attempt,max_attempts"
        )
        for row in rows:
            self._patch(
                row["id"],
                {
                    "status": "queued",
                    "claimed_by": None,
                    "lease_expires_at": None,
                    "last_error": "lease_expired",
                },
            )
        return len(rows)

    def claim_batch(
        self,
        *,
        worker_id: str,
        batch_size: int = 1,
        lease_seconds: int = 120,
    ) -> list[AnalysisJob]:
        self.reclaim_expired()
        rows = self._get(
            "status=eq.queued&order=created_at.asc&limit=" + str(max(1, batch_size))
        )
        claimed: list[AnalysisJob] = []
        now = _utcnow()
        for row in rows:
            body = {
                "status": "running",
                "attempt": int(row.get("attempt") or 0) + 1,
                "claimed_by": worker_id,
                "claimed_at": _iso(now),
                "heartbeat_at": _iso(now),
                "lease_expires_at": _iso(now + timedelta(seconds=lease_seconds)),
                "started_at": row.get("started_at") or _iso(now),
                "error": None,
            }
            # Optimistic: only claim if still queued
            res = httpx.patch(
                f"{self.auth.url}/rest/v1/analysis_jobs?id=eq.{row['id']}&status=eq.queued",
                headers={**self.auth.headers, "Prefer": "return=representation"},
                json=body,
                timeout=60.0,
            )
            if res.status_code >= 400:
                continue
            data = res.json()
            if isinstance(data, list) and data:
                claimed.append(AnalysisJob.from_dict({**row, **data[0]}))
            elif isinstance(data, dict) and data.get("id"):
                claimed.append(AnalysisJob.from_dict({**row, **data}))
        return claimed

    def heartbeat(self, job_id: str, *, worker_id: str, lease_seconds: int = 120) -> bool:
        now = _utcnow()
        res = httpx.patch(
            f"{self.auth.url}/rest/v1/analysis_jobs?id=eq.{job_id}&claimed_by=eq.{worker_id}&status=eq.running",
            headers={**self.auth.headers, "Prefer": "return=minimal"},
            json={
                "heartbeat_at": _iso(now),
                "lease_expires_at": _iso(now + timedelta(seconds=lease_seconds)),
            },
            timeout=30.0,
        )
        return res.status_code < 400

    def complete(self, job_id: str, *, result: dict[str, Any] | None = None) -> None:
        self._patch(
            job_id,
            {
                "status": "completed",
                "finished_at": _iso(),
                "lease_expires_at": None,
                "error": None,
                "result": result,
            },
        )

    def fail(self, job_id: str, *, error: str, attempt: int, max_attempts: int) -> None:
        if attempt >= max_attempts:
            body = {
                "status": "dead",
                "error": error,
                "last_error": error,
                "finished_at": _iso(),
                "lease_expires_at": None,
            }
        else:
            body = {
                "status": "queued",
                "error": error,
                "last_error": error,
                "claimed_by": None,
                "lease_expires_at": None,
            }
        self._patch(job_id, body)


def resolve_queue():
    """Prefer Supabase when service-role env is set; else local file queue."""
    from app.config import get_settings

    settings = get_settings()
    url = (settings.supabase_url or "").strip()
    key = (settings.supabase_service_role_key or "").strip()
    if url and key:
        return SupabaseJobQueue(ServiceAuth(url=url, service_role_key=key))
    return LocalJobQueue()
