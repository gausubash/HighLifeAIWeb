"""CLI for running mock or real prediction locally."""

from __future__ import annotations

import argparse
import json
import sys

from app.config import Device, RunMode, get_settings
from app.pipeline.run import run_pipeline


def main() -> int:
    parser = argparse.ArgumentParser(description="Run floor-plan analysis prediction")
    parser.add_argument("--analysis-id", default="mock-analysis")
    parser.add_argument("--project-id", default="mock-project")
    parser.add_argument("--source-file", default="mock_floor_plan.pdf")
    parser.add_argument("--mode", choices=["mock", "real"], default=None)
    parser.add_argument("--device", choices=["cpu", "cuda"], default=None)
    parser.add_argument("--output", default="-", help="Output path or '-' for stdout")
    args = parser.parse_args()

    settings = get_settings()
    if args.mode:
        settings.run_mode = RunMode(args.mode)
    if args.device:
        settings.device = Device(args.device)

    try:
        result = run_pipeline(
            analysis_id=args.analysis_id,
            project_id=args.project_id,
            source_file_name=args.source_file,
            settings=settings,
        )
    except NotImplementedError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    payload = result.model_dump(mode="json")
    text = json.dumps(payload, indent=2, default=str)

    if args.output == "-":
        print(text)
    else:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"Wrote {args.output}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
