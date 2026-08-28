"""Phases 6 + 9 local job queue."""

from __future__ import annotations

from pathlib import Path

from app.jobs.queue import LocalJobQueue


def test_claim_heartbeat_retry_and_dead(tmp_path: Path) -> None:
    q = LocalJobQueue(tmp_path)
    job = q.enqueue(analysis_id="a1", payload={"project_id": "p"}, max_attempts=2)
    claimed = q.claim_batch(worker_id="w1", batch_size=2, lease_seconds=60)
    assert len(claimed) == 1
    assert claimed[0].id == job.id
    assert claimed[0].attempt == 1
    assert q.heartbeat(job.id, worker_id="w1", lease_seconds=60)

    failed = q.fail(job.id, error="boom")
    assert failed.status == "queued"
    claimed2 = q.claim_batch(worker_id="w2", batch_size=1)
    assert claimed2[0].attempt == 2
    dead = q.fail(claimed2[0].id, error="boom2")
    assert dead.status == "dead"


def test_batch_claim(tmp_path: Path) -> None:
    q = LocalJobQueue(tmp_path)
    q.enqueue(analysis_id="a1")
    q.enqueue(analysis_id="a2")
    q.enqueue(analysis_id="a3")
    batch = q.claim_batch(worker_id="w", batch_size=2)
    assert len(batch) == 2
    assert {j.status for j in batch} == {"running"}
