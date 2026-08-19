"""Process a single queued analysis job (GPU VM one-shot command)."""

from __future__ import annotations

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Process one analysis job")
    parser.add_argument("--analysis-id", required=True)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    args = parser.parse_args()

    print(
        f"process_one_job stub: analysis_id={args.analysis_id} device={args.device}",
        file=sys.stderr,
    )
    print("Full worker implementation added in Phase 6 (Supabase job claiming).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
