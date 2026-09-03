"""Polling worker for queued analysis jobs (Phases 6 + 9)."""

from __future__ import annotations

import argparse
import logging
import socket
import sys
import threading
import time
import uuid

from app.config import Device, resolve_device
from app.jobs.process import process_job
from app.jobs.queue import LocalJobQueue, SupabaseJobQueue, resolve_queue

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("worker")


def _worker_id() -> str:
    return f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}"


def _heartbeat_loop(
    queue,
    job_id: str,
    worker_id: str,
    stop: threading.Event,
    *,
    interval: float,
    lease_seconds: int,
) -> None:
    while not stop.wait(interval):
        try:
            ok = queue.heartbeat(job_id, worker_id=worker_id, lease_seconds=lease_seconds)
            if not ok:
                logger.warning("Heartbeat rejected for job %s", job_id)
                break
        except Exception:
            logger.exception("Heartbeat failed for job %s", job_id)


def run_once(
    queue,
    *,
    worker_id: str,
    batch_size: int,
    lease_seconds: int,
    heartbeat_interval: float,
    device: str,
) -> int:
    jobs = queue.claim_batch(worker_id=worker_id, batch_size=batch_size, lease_seconds=lease_seconds)
    if not jobs:
        return 0
    for job in jobs:
        stop = threading.Event()
        thread = threading.Thread(
            target=_heartbeat_loop,
            args=(queue, job.id, worker_id, stop),
            kwargs={"interval": heartbeat_interval, "lease_seconds": lease_seconds},
            daemon=True,
        )
        thread.start()
        try:
            logger.info("Processing job %s analysis=%s attempt=%s", job.id, job.analysis_id, job.attempt)
            result = process_job(job, device=device)
            if isinstance(queue, LocalJobQueue):
                queue.complete(job.id, result=result)
            else:
                queue.complete(job.id, result=result)
                # Persist analysis_results when Supabase is available
                _maybe_write_supabase_result(queue, job, result)
            logger.info("Completed job %s", job.id)
        except Exception as exc:
            logger.exception("Job %s failed", job.id)
            if isinstance(queue, LocalJobQueue):
                queue.fail(job.id, error=str(exc))
            else:
                queue.fail(
                    job.id,
                    error=str(exc),
                    attempt=job.attempt,
                    max_attempts=job.max_attempts,
                )
        finally:
            stop.set()
            thread.join(timeout=2)
    return len(jobs)


def _maybe_write_supabase_result(queue: SupabaseJobQueue, job, result: dict) -> None:
    try:
        import httpx

        auth = queue.auth
        httpx.patch(
            f"{auth.url}/rest/v1/analyses?id=eq.{job.analysis_id}",
            headers={**auth.headers, "Prefer": "return=minimal"},
            json={
                "status": "completed",
                "progress": 100,
                "current_stage": "completed",
                "completed_at": result.get("created_at"),
            },
            timeout=60.0,
        )
        httpx.post(
            f"{auth.url}/rest/v1/analysis_results",
            headers={**auth.headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
            json={
                "analysis_id": job.analysis_id,
                "owner_id": job.owner_id,
                "result": result,
                "overlays": {},
            },
            timeout=60.0,
        )
    except Exception:
        logger.exception("Could not write analysis_results for %s", job.analysis_id)


def _resolve_worker_device(arg: str) -> str:
    if arg == "auto":
        return resolve_device(Device.AUTO).value
    return arg


def main() -> int:
    parser = argparse.ArgumentParser(description="Poll and process analysis jobs")
    parser.add_argument("--device", choices=["cpu", "cuda", "auto"], default="auto")
    parser.add_argument("--poll-interval", type=float, default=5.0)
    parser.add_argument("--batch-size", type=int, default=1, help="Jobs claimed per poll (Phase 9)")
    parser.add_argument("--lease-seconds", type=int, default=120)
    parser.add_argument("--heartbeat-interval", type=float, default=30.0)
    parser.add_argument("--once", action="store_true", help="Process at most one batch then exit")
    parser.add_argument("--enqueue-demo", action="store_true", help="Enqueue a mock local job then exit")
    args = parser.parse_args()
    device = _resolve_worker_device(args.device)

    queue = resolve_queue()
    worker_id = _worker_id()
    backend = "supabase" if isinstance(queue, SupabaseJobQueue) else "local"
    logger.info("Worker %s starting (backend=%s device=%s)", worker_id, backend, device)

    if args.enqueue_demo:
        if not isinstance(queue, LocalJobQueue):
            logger.error("--enqueue-demo only supported for local queue")
            return 1
        job = queue.enqueue(analysis_id=f"demo-{uuid.uuid4().hex[:8]}", payload={"project_id": "demo"})
        print(job.id)
        return 0

    while True:
        n = run_once(
            queue,
            worker_id=worker_id,
            batch_size=args.batch_size,
            lease_seconds=args.lease_seconds,
            heartbeat_interval=args.heartbeat_interval,
            device=device,
        )
        if args.once:
            return 0 if n >= 0 else 1
        time.sleep(max(0.5, args.poll_interval))


if __name__ == "__main__":
    raise SystemExit(main())
