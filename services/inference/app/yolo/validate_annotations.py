"""Validate master LabelMe annotations against class list + dataset folds (Phase 4)."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import yaml

from app.yolo.classes import canonical_label, entity_type_for
from app.yolo.convert_labelme import (
    DEFAULT_DATASET_YAML,
    PREFIX_TO_BUILDING,
    building_id_from_stem,
    looks_like_labelme,
    load_fold,
)

MIN_POLYGON_POINTS = 3
MIN_BOX_AREA_PX = 4.0


@dataclass
class AnnotationIssue:
    path: str
    severity: str  # error | warning
    code: str
    message: str


@dataclass
class ValidationReport:
    ok: bool
    files_checked: int
    shapes_checked: int
    errors: list[AnnotationIssue] = field(default_factory=list)
    warnings: list[AnnotationIssue] = field(default_factory=list)
    buildings_seen: list[str] = field(default_factory=list)
    fold: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "files_checked": self.files_checked,
            "shapes_checked": self.shapes_checked,
            "buildings_seen": self.buildings_seen,
            "fold": self.fold,
            "errors": [asdict(i) for i in self.errors],
            "warnings": [asdict(i) for i in self.warnings],
        }


def _poly_area(points: list[list[float]]) -> float:
    if len(points) < 3:
        return 0.0
    area = 0.0
    n = len(points)
    for i in range(n):
        x1, y1 = points[i][0], points[i][1]
        x2, y2 = points[(i + 1) % n][0], points[(i + 1) % n][1]
        area += x1 * y2 - x2 * y1
    return abs(area) * 0.5


def _iter_labelme(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.json") if looks_like_labelme(p))


def validate_labelme_dir(
    src: Path,
    *,
    fold: str | None = None,
    dataset_yaml: Path | None = None,
    require_building: bool = False,
) -> ValidationReport:
    root = Path(src)
    report = ValidationReport(ok=True, files_checked=0, shapes_checked=0, fold=fold)
    if not root.is_dir():
        report.ok = False
        report.errors.append(
            AnnotationIssue(str(root), "error", "NOT_A_DIR", "Source path is not a directory.")
        )
        return report

    train_buildings: set[str] = set()
    test_buildings: set[str] = set()
    if fold:
        train_buildings, test_buildings = load_fold(dataset_yaml or DEFAULT_DATASET_YAML, fold)

    buildings: set[str] = set()
    files = _iter_labelme(root)
    if not files:
        report.ok = False
        report.errors.append(
            AnnotationIssue(str(root), "error", "NO_LABELME", "No LabelMe JSON files found.")
        )
        return report

    for path in files:
        report.files_checked += 1
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            report.errors.append(
                AnnotationIssue(str(path), "error", "BAD_JSON", f"Cannot parse JSON: {exc}")
            )
            continue

        stem = path.stem
        building = building_id_from_stem(stem)
        if building:
            buildings.add(building)
        elif require_building or fold:
            report.errors.append(
                AnnotationIssue(
                    str(path),
                    "error",
                    "UNKNOWN_BUILDING",
                    f"Stem {stem!r} does not map to a known building "
                    f"(prefixes: {sorted(PREFIX_TO_BUILDING)}).",
                )
            )

        if fold and building:
            if building not in train_buildings and building not in test_buildings:
                report.errors.append(
                    AnnotationIssue(
                        str(path),
                        "error",
                        "BUILDING_NOT_IN_FOLD",
                        f"Building {building} is not in fold {fold}.",
                    )
                )

        shapes = payload.get("shapes") or []
        if not isinstance(shapes, list) or not shapes:
            report.warnings.append(
                AnnotationIssue(str(path), "warning", "EMPTY_SHAPES", "No shapes on this page.")
            )
            continue

        for idx, shape in enumerate(shapes):
            if not isinstance(shape, dict):
                continue
            report.shapes_checked += 1
            label_raw = str(shape.get("label") or "")
            if not label_raw.strip():
                report.errors.append(
                    AnnotationIssue(
                        str(path),
                        "error",
                        "EMPTY_LABEL",
                        f"Shape[{idx}] has an empty label.",
                    )
                )
                continue
            if canonical_label(label_raw) is None and entity_type_for(label_raw) == "other":
                # Allow layout meta labels that map to entity types other than "other"
                # and any CLASS_NAMES / aliases; reject truly unknown strings.
                from app.yolo.classes import LABEL_TO_ENTITY_TYPE

                if _norm_unknown(label_raw) not in {_norm_unknown(k) for k in LABEL_TO_ENTITY_TYPE}:
                    report.errors.append(
                        AnnotationIssue(
                            str(path),
                            "error",
                            "UNKNOWN_LABEL",
                            f"Shape[{idx}] label {label_raw!r} is not in the master class list.",
                        )
                    )

            points = shape.get("points") or []
            if not isinstance(points, list) or len(points) < 2:
                report.errors.append(
                    AnnotationIssue(
                        str(path),
                        "error",
                        "BAD_GEOMETRY",
                        f"Shape[{idx}] ({label_raw!r}) has fewer than 2 points.",
                    )
                )
                continue
            shape_type = str(shape.get("shape_type") or "polygon").lower()
            if shape_type == "polygon" and len(points) < MIN_POLYGON_POINTS:
                report.errors.append(
                    AnnotationIssue(
                        str(path),
                        "error",
                        "OPEN_POLYGON",
                        f"Shape[{idx}] polygon needs ≥{MIN_POLYGON_POINTS} points.",
                    )
                )
            try:
                pts = [[float(p[0]), float(p[1])] for p in points]
            except (TypeError, ValueError, IndexError):
                report.errors.append(
                    AnnotationIssue(
                        str(path),
                        "error",
                        "BAD_POINTS",
                        f"Shape[{idx}] points are not numeric pairs.",
                    )
                )
                continue
            area = _poly_area(pts) if len(pts) >= 3 else abs(
                (pts[1][0] - pts[0][0]) * (pts[1][1] - pts[0][1])
            )
            if area < MIN_BOX_AREA_PX:
                report.warnings.append(
                    AnnotationIssue(
                        str(path),
                        "warning",
                        "TINY_SHAPE",
                        f"Shape[{idx}] ({label_raw!r}) area {area:.1f}px² is very small.",
                    )
                )

    # Train/test leakage: same building must not appear in both sides of the fold config itself
    # (already enforced by yaml). Warn if folder mixes train+test buildings without split metadata.
    if fold and buildings:
        in_train = buildings & train_buildings
        in_test = buildings & test_buildings
        if in_train and in_test:
            report.errors.append(
                AnnotationIssue(
                    str(root),
                    "error",
                    "FOLD_LEAKAGE",
                    f"Folder mixes train buildings {sorted(in_train)} with test "
                    f"{sorted(in_test)} for {fold}. Keep buildings on one side only.",
                )
            )

    report.buildings_seen = sorted(buildings)
    report.ok = len(report.errors) == 0
    return report


def _norm_unknown(label: str) -> str:
    return " ".join(label.strip().lower().replace("_", " ").replace("-", " ").split())


def list_folds(dataset_yaml: Path | None = None) -> list[str]:
    path = dataset_yaml or DEFAULT_DATASET_YAML
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return sorted((data.get("splits") or {}).keys())
