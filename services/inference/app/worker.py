"""Polling worker for queued analysis jobs (GPU VM batch mode)."""

from __future__ import annotations

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Poll and process analysis jobs")
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--poll-interval", type=int, default=30)
    args = parser.parse_args()

    print(
        f"worker stub: device={args.device} poll_interval={args.poll_interval}s",
        file=sys.stderr,
    )
    print("Full worker implementation added in Phase 6 (Supabase job claiming).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
