#!/usr/bin/env python3
"""Validate master LabelMe annotations (Phase 4).

Usage (from repo root or services/inference):
  python scripts/validate_annotations.py --src path/to/labelme --fold fold_1
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
INFERENCE_ROOT = REPO_ROOT / "services" / "inference"
if str(INFERENCE_ROOT) not in sys.path:
    sys.path.insert(0, str(INFERENCE_ROOT))


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate master LabelMe annotations")
    parser.add_argument("--src", required=True, type=Path, help="LabelMe folder")
    parser.add_argument("--fold", default=None, help="Optional LOBO fold (e.g. fold_1)")
    parser.add_argument(
        "--dataset-yaml",
        type=Path,
        default=None,
        help="Override configs/dataset.yaml",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable report")
    parser.add_argument(
        "--require-building",
        action="store_true",
        help="Fail when filename stem has no building prefix",
    )
    args = parser.parse_args()

    from app.yolo.validate_annotations import list_folds, validate_labelme_dir

    if args.fold == "list":
        print("\n".join(list_folds(args.dataset_yaml)))
        return 0

    report = validate_labelme_dir(
        args.src,
        fold=args.fold,
        dataset_yaml=args.dataset_yaml,
        require_building=args.require_building or bool(args.fold),
    )
    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
    else:
        print(
            f"Checked {report.files_checked} file(s), {report.shapes_checked} shape(s)"
            + (f" · fold={report.fold}" if report.fold else "")
        )
        if report.buildings_seen:
            print("Buildings:", ", ".join(report.buildings_seen))
        for issue in report.errors:
            print(f"ERROR [{issue.code}] {issue.path}: {issue.message}")
        for issue in report.warnings:
            print(f"WARN  [{issue.code}] {issue.path}: {issue.message}")
        print("OK" if report.ok else "FAILED")
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
