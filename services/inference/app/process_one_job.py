"""Process a single queued analysis job (GPU VM one-shot command)."""

from __future__ import annotations

import argparse
import logging
import socket
import sys
import uuid

from app.jobs.process import process_job
from app.jobs.queue import LocalJobQueue, resolve_queue

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("process_one_job")


def main() -> int:
    parser = argparse.ArgumentParser(description="Process one analysis job")
    parser.add_argument("--analysis-id", required=True)
    parser.add_argument("--job-id", default=None, help="Existing job id (local or Supabase)")
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--enqueue", action="store_true", help="Create a local queued job first")
    parser.add_argument("--project-id", default="local")
    parser.add_argument("--image-path", default=None)
    args = parser.parse_args()

    queue = resolve_queue()
    worker_id = f"{socket.gethostname()}-oneshot-{uuid.uuid4().hex[:6]}"

    job = None
    if args.job_id and isinstance(queue, LocalJobQueue):
        job = queue.get(args.job_id)
    if job is None and args.enqueue and isinstance(queue, LocalJobQueue):
        job = queue.enqueue(
            analysis_id=args.analysis_id,
            owner_id=args.project_id,
            payload={
                "project_id": args.project_id,
                "image_path": args.image_path,
                "source_file_name": args.image_path or f"{args.analysis_id}.pdf",
            },
        )
    if job is None and isinstance(queue, LocalJobQueue):
        # Find newest queued job for this analysis
        for candidate in reversed(queue.list_jobs()):
            if candidate.analysis_id == args.analysis_id and candidate.status in {"queued", "running"}:
                job = candidate
                break

    if job is None:
        # Synthesize ephemeral local job (no queue row) for one-shot
        from app.jobs.queue import AnalysisJob

        job = AnalysisJob(
            id=str(uuid.uuid4()),
            analysis_id=args.analysis_id,
            owner_id=args.project_id,
            status="running",
            attempt=1,
            payload={
                "project_id": args.project_id,
                "image_path": args.image_path,
                "source_file_name": args.image_path or f"{args.analysis_id}.pdf",
            },
        )
        result = process_job(job, device=args.device)
        print(result.get("status") or "ok")
        return 0

    claimed = queue.claim_batch(worker_id=worker_id, batch_size=1) if job.status == "queued" else [job]
    if not claimed:
        # Force-claim by id for local
        if isinstance(queue, LocalJobQueue) and job.status == "queued":
            job.status = "running"
            job.attempt += 1
            job.claimed_by = worker_id
            queue._write(job)  # noqa: SLF001 — one-shot helper
            claimed = [job]
        else:
            logger.error("No claimable job for analysis %s", args.analysis_id)
            return 1

    target = claimed[0]
    try:
        result = process_job(target, device=args.device)
        if isinstance(queue, LocalJobQueue):
            queue.complete(target.id, result=result)
        else:
            queue.complete(target.id, result=result)
        print(target.id)
        return 0
    except Exception as exc:
        logger.exception("Failed")
        if isinstance(queue, LocalJobQueue):
            queue.fail(target.id, error=str(exc))
        else:
            queue.fail(
                target.id,
                error=str(exc),
                attempt=target.attempt,
                max_attempts=target.max_attempts,
            )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
