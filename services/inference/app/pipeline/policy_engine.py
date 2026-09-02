"""Deterministic design-policy evaluation over a scene graph."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4
from datetime import datetime, timezone

import yaml

from app.schemas import ComplianceResultCategory, ComplianceResultSchema

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_PACK = REPO_ROOT / "configs" / "policies" / "hooper_apartment_rules_v1.yaml"


def resolve_policy_pack_path(explicit: str | None = None) -> Path:
    if explicit and explicit.strip():
        raw = explicit.strip()
        path = Path(raw).expanduser()
        if path.is_file():
            return path.resolve()
        # Treat as version id → configs/policies/<version>.yaml
        candidate = REPO_ROOT / "configs" / "policies" / f"{raw}.yaml"
        if candidate.is_file():
            return candidate.resolve()
        # Allow highlife_v1 without forcing path
        if not raw.endswith(".yaml"):
            alt = REPO_ROOT / "configs" / "policies" / f"{raw}.yaml"
            if alt.is_file():
                return alt.resolve()
        return path.resolve()
    return DEFAULT_PACK


def list_policy_packs() -> list[dict]:
    folder = REPO_ROOT / "configs" / "policies"
    packs: list[dict] = []
    if not folder.is_dir():
        return packs
    for path in sorted(folder.glob("*.yaml")):
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            continue
        packs.append(
            {
                "id": str(data.get("version") or path.stem),
                "name": str(data.get("name") or path.stem),
                "path": str(path),
                "rule_count": len(data.get("rules") or []),
            }
        )
    return packs


def load_policy_pack(path: Path | None = None) -> dict[str, Any]:
    pack_path = path or DEFAULT_PACK
    data = yaml.safe_load(pack_path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict) or not data.get("rules"):
        raise ValueError(f"Invalid policy pack at {pack_path}")
    return data


def _label_of(entity: dict[str, Any]) -> str:
    attrs = entity.get("attributes") or {}
    return str(attrs.get("label") or entity.get("type") or "").strip()


def _norm(label: str) -> str:
    return label.strip().lower().replace("_", " ")


def _room_entities(graph: dict[str, Any]) -> list[dict[str, Any]]:
    return [e for e in graph.get("entities") or [] if str(e.get("type")) == "room"]


def _wall_entities(graph: dict[str, Any]) -> list[dict[str, Any]]:
    return [e for e in graph.get("entities") or [] if str(e.get("type")) == "wall"]


def _area_m2_for(entity_id: str, graph: dict[str, Any]) -> float | None:
    for m in graph.get("measurements") or []:
        if m.get("kind") == "room_area" and entity_id in (m.get("sourceGeometryIds") or []):
            val = m.get("valueM2")
            return float(val) if val is not None else None
    return None


def _has_scale(graph: dict[str, Any]) -> bool:
    cal = graph.get("calibration")
    return bool(cal and float(cal.get("mmPerPixel") or 0) > 0)


def evaluate_policy(
    graph: dict[str, Any],
    *,
    analysis_id: str,
    unit_external_id: str = "unit-1",
    pack: dict[str, Any] | None = None,
    pack_path: Path | None = None,
) -> list[ComplianceResultSchema]:
    pack = pack or load_policy_pack(pack_path)
    policy_version = str(pack.get("version") or "unknown")
    results: list[ComplianceResultSchema] = []
    rooms = _room_entities(graph)
    walls = _wall_entities(graph)
    scaled = _has_scale(graph)
    now = datetime.now(timezone.utc)

    def _row(**kwargs) -> ComplianceResultSchema:
        return ComplianceResultSchema(created_at=now, **kwargs)

    for rule in pack.get("rules") or []:
        code = str(rule.get("code") or "UNKNOWN")
        needs_scale = bool(rule.get("requires_scale"))
        kind = str(rule.get("kind") or "")
        if kind.startswith("apartment_") or kind == "communal_open_space":
            # Apartment RDS rules run in the web Policy tab against extracted units.
            continue

        if needs_scale and not scaled:
            results.append(
                _row(
                    id=str(uuid4()),
                    analysis_id=analysis_id,
                    unit_external_id=unit_external_id,
                    rule_code=code,
                    policy_version=policy_version,
                    result=ComplianceResultCategory.UNCERTAIN,
                    explanation="Scale not calibrated — metric rule deferred.",
                    evidence={"reason": "missing_scale"},
                    confidence=0.4,
                )
            )
            continue

        if code.endswith("TYPES-REQUIRED") or rule.get("required_labels"):
            required = [_norm(x) for x in (rule.get("required_labels") or [])]
            present = {_norm(_label_of(r)) for r in rooms}
            missing = [r for r in required if r not in present]
            # Also accept partial contains (Bedroom in "Master Bedroom").
            still = []
            for m in missing:
                if not any(m in p or p in m for p in present):
                    still.append(m)
            if still:
                results.append(
                    _row(
                        id=str(uuid4()),
                        analysis_id=analysis_id,
                        unit_external_id=unit_external_id,
                        rule_code=code,
                        policy_version=policy_version,
                        result=ComplianceResultCategory.FAIL,
                        explanation=str(rule.get("explanation") or "Missing rooms.").format(
                            missing=", ".join(still)
                        ),
                        evidence={"missing": still, "present": sorted(present)},
                        confidence=0.85,
                    )
                )
            else:
                results.append(
                    _row(
                        id=str(uuid4()),
                        analysis_id=analysis_id,
                        unit_external_id=unit_external_id,
                        rule_code=code,
                        policy_version=policy_version,
                        result=ComplianceResultCategory.PASS,
                        explanation="Required room types are present.",
                        evidence={"present": sorted(present)},
                        confidence=0.9,
                    )
                )
            continue

        if rule.get("min_wall_count") is not None:
            need = int(rule.get("min_wall_count") or 1)
            if len(walls) < need:
                results.append(
                    _row(
                        id=str(uuid4()),
                        analysis_id=analysis_id,
                        unit_external_id=unit_external_id,
                        rule_code=code,
                        policy_version=policy_version,
                        result=ComplianceResultCategory.UNCERTAIN,
                        explanation=str(rule.get("explanation") or "No walls."),
                        evidence={"wallCount": len(walls)},
                        confidence=0.7,
                    )
                )
            else:
                results.append(
                    _row(
                        id=str(uuid4()),
                        analysis_id=analysis_id,
                        unit_external_id=unit_external_id,
                        rule_code=code,
                        policy_version=policy_version,
                        result=ComplianceResultCategory.PASS,
                        explanation=f"{len(walls)} wall region(s) present.",
                        evidence={"wallCount": len(walls)},
                        confidence=0.9,
                    )
                )
            continue

        labels = [_norm(x) for x in (rule.get("room_labels") or [])]
        min_area = float(rule.get("min_area_m2") or 0)
        matches = [
            r
            for r in rooms
            if any(lab in _norm(_label_of(r)) or _norm(_label_of(r)) in lab for lab in labels)
        ]
        if not matches:
            if rule.get("optional_if_absent"):
                results.append(
                    _row(
                        id=str(uuid4()),
                        analysis_id=analysis_id,
                        unit_external_id=unit_external_id,
                        rule_code=code,
                        policy_version=policy_version,
                        result=ComplianceResultCategory.NOT_APPLICABLE,
                        explanation="No matching room label on this page.",
                        evidence={"labels": labels},
                        confidence=0.8,
                    )
                )
            else:
                results.append(
                    _row(
                        id=str(uuid4()),
                        analysis_id=analysis_id,
                        unit_external_id=unit_external_id,
                        rule_code=code,
                        policy_version=policy_version,
                        result=ComplianceResultCategory.FAIL,
                        explanation=f"No rooms matching {labels} found.",
                        evidence={"labels": labels},
                        confidence=0.75,
                    )
                )
            continue

        # Evaluate each matching room.
        for room in matches:
            area = _area_m2_for(str(room["id"]), graph)
            if area is None:
                results.append(
                    _row(
                        id=str(uuid4()),
                        analysis_id=analysis_id,
                        unit_external_id=unit_external_id,
                        rule_code=code,
                        policy_version=policy_version,
                        result=ComplianceResultCategory.UNCERTAIN,
                        explanation="Room found but area measurement missing.",
                        evidence={"entityId": room["id"]},
                        confidence=0.5,
                    )
                )
                continue
            passed = area >= min_area
            tmpl = str(rule.get("explanation") or "Area {measured} vs {required}.")
            results.append(
                _row(
                    id=str(uuid4()),
                    analysis_id=analysis_id,
                    unit_external_id=unit_external_id,
                    rule_code=code,
                    policy_version=policy_version,
                    result=ComplianceResultCategory.PASS if passed else ComplianceResultCategory.FAIL,
                    measured_value=area,
                    required_value=min_area,
                    unit="m2",
                    explanation=tmpl.format(measured=area, required=min_area),
                    evidence={"entityId": room["id"], "label": _label_of(room)},
                    confidence=float(room.get("confidence") or 0.7),
                )
            )

    return results
