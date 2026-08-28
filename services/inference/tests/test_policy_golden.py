"""Golden eval: scene graph + design-policy pack on a synthetic unit plan."""

from __future__ import annotations

from app.pipeline.policy_engine import evaluate_policy, load_policy_pack
from app.pipeline.scene_graph import build_scene_graph
from app.pipeline.sheet_context import heuristic_sheet_meta
from app.yolo.predict import DetectResult, DetectedRegion
import numpy as np


def _region(
    *,
    rid: str,
    etype: str,
    label: str,
    polygon: list[tuple[float, float]],
    conf: float = 0.9,
) -> DetectedRegion:
    xs = [p[0] for p in polygon]
    ys = [p[1] for p in polygon]
    return DetectedRegion(
        id=rid,
        type=etype,
        label=label,
        confidence=conf,
        polygon=polygon,
        bbox=(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)),
        attributes={"label": label},
    )


def test_golden_policy_pack_bedroom_fail_and_walls_pass():
    # 10 px/mm → 0.1 mm/px? Wait: mm_per_pixel = 50 means 50mm per pixel (coarse).
    # Bedroom polygon 100x80 px → area_px=8000 → m2 = 8000 * (0.05)^2 = 20 if mm_per_pixel=50?
    # m_per_px = mm_per_pixel/1000. For 9 m² min with small bedroom:
    # Use mm_per_pixel=10 (10mm/px) → m_per_px=0.01
    # Bedroom 80x60=4800 px² → 4800*0.0001=0.48 m² → fail min 9.
    detect = DetectResult(
        model_id="golden",
        model_version="1",
        width_px=1000,
        height_px=800,
        regions=[
            _region(
                rid="w1",
                etype="wall",
                label="Wall",
                polygon=[(50, 50), (900, 50), (900, 70), (50, 70)],
            ),
            _region(
                rid="bed1",
                etype="room",
                label="Bedroom",
                polygon=[(100, 100), (180, 100), (180, 160), (100, 160)],
            ),
            _region(
                rid="bath1",
                etype="room",
                label="Bathroom",
                polygon=[(200, 100), (280, 100), (280, 160), (200, 160)],
            ),
        ],
    )
    graph = build_scene_graph(
        detect,
        project_id="golden",
        analysis_run_id="golden-run",
        mm_per_pixel=10.0,
        calibration_verified=True,
        sheet_meta=heuristic_sheet_meta(np.full((200, 200, 3), 240, dtype=np.uint8)),
        entity_statuses={"bed1": "user_confirmed", "bath1": "user_confirmed", "w1": "predicted"},
    )
    assert graph["calibration"] is not None
    assert any(m["kind"] == "room_area" for m in graph["measurements"])

    pack = load_policy_pack()
    results = evaluate_policy(graph, analysis_id="golden-run", pack=pack)
    by_code = {r.rule_code: r for r in results}
    assert by_code["HL-WALL-PRESENT"].result.value == "pass"
    assert by_code["HL-ROOM-TYPES-REQUIRED"].result.value == "pass"
    assert by_code["HL-ROOM-BED-MIN"].result.value == "fail"
    assert by_code["HL-ROOM-BED-MIN"].measured_value is not None
    assert by_code["HL-ROOM-BED-MIN"].measured_value < 9.0


def test_golden_missing_scale_marks_metric_uncertain():
    detect = DetectResult(
        model_id="golden",
        model_version="1",
        width_px=400,
        height_px=400,
        regions=[
            _region(
                rid="bed1",
                etype="room",
                label="Bedroom",
                polygon=[(10, 10), (100, 10), (100, 100), (10, 100)],
            ),
        ],
    )
    graph = build_scene_graph(detect, project_id="p", mm_per_pixel=None)
    results = evaluate_policy(graph, analysis_id="a")
    bed = next(r for r in results if r.rule_code == "HL-ROOM-BED-MIN")
    assert bed.result.value == "uncertain"
