from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.detect.regions import ProposedRegion

# LabelMe-aligned class set (see local annotation backup). Overlay uses `label`.
CLASS_LABELS = (
    "Unit",
    "Open Living",
    "Bedroom",
    "Bathroom",
    "Ensuite",
    "Laundry",
    "Closet",
    "Store",
    "Balcony",
    "Lobby",
    "Communal Space",
)

LABEL_TO_ENTITY_TYPE: dict[str, str] = {
    "Unit": "unit_boundary",
    "Open Living": "room",
    "Bedroom": "room",
    "Bathroom": "room",
    "Ensuite": "room",
    "Laundry": "room",
    "Closet": "room",
    "Store": "room",
    "Balcony": "room",
    "Lobby": "room",
    "Communal Space": "room",
}

ROOM_TYPE_ATTR: dict[str, str] = {
    "Unit": "unit",
    "Open Living": "living",
    "Bedroom": "bedroom",
    "Bathroom": "bathroom",
    "Ensuite": "bathroom",
    "Laundry": "laundry",
    "Closet": "closet",
    "Store": "store",
    "Balcony": "balcony",
    "Lobby": "lobby",
    "Communal Space": "common_corridor",
}


@dataclass(frozen=True)
class RegionFeatures:
    area_frac: float
    aspect: float
    compactness: float
    edge_dist: float
    cx: float
    cy: float
    mean_gray: float
    ink_density: float


def extract_features(
    region: ProposedRegion,
    *,
    page_width: float,
    page_height: float,
) -> RegionFeatures:
    page_area = max(page_width * page_height, 1.0)
    x, y, w, h = region.bbox
    aspect = max(w, h) / max(min(w, h), 1.0)
    peri = max(region.perimeter_px, 1.0)
    compactness = float((4.0 * np.pi * region.area_px) / (peri * peri))
    cx = (x + w / 2.0) / page_width
    cy = (y + h / 2.0) / page_height
    edge_dist = min(cx, cy, 1.0 - cx, 1.0 - cy)
    return RegionFeatures(
        area_frac=region.area_px / page_area,
        aspect=aspect,
        compactness=max(0.0, min(compactness, 1.5)),
        edge_dist=edge_dist,
        cx=cx,
        cy=cy,
        mean_gray=region.mean_gray / 255.0,
        ink_density=region.ink_density,
    )


def _softmax(scores: dict[str, float]) -> dict[str, float]:
    if not scores:
        return {}
    max_s = max(scores.values())
    exps = {k: float(np.exp(v - max_s)) for k, v in scores.items()}
    total = sum(exps.values()) or 1.0
    return {k: v / total for k, v in exps.items()}


class RegionClassifier:
    """Geometric classifier for enclosed floor-plan spaces.

    Feature weights follow LabelMe class priors (units and habitable rooms are
    large interior polygons; balconies sit on the sheet edge; wet rooms and
    closets are small). Swap this for a joblib model trained on LabelMe later.
    """

    model_id = "layout_region_clf"
    model_version = "0.1.0-cpu"

    def predict(self, features: RegionFeatures) -> tuple[str, float]:
        f = features
        scores: dict[str, float] = {label: 0.0 for label in CLASS_LABELS}

        scores["Unit"] += 3.4 * f.area_frac * 12.0 + 1.2 * f.compactness + 1.6 * f.edge_dist
        scores["Open Living"] += 2.8 * (f.area_frac * 18.0) + 1.4 * f.compactness
        scores["Bedroom"] += 2.2 * (0.08 - abs(f.area_frac - 0.035)) * 40.0 + 1.1 * f.compactness
        scores["Bathroom"] += 2.4 * (0.025 - abs(f.area_frac - 0.012)) * 50.0 + 0.8 * (2.2 - f.aspect)
        scores["Ensuite"] += 2.0 * (0.02 - abs(f.area_frac - 0.01)) * 45.0
        scores["Laundry"] += 1.6 * (0.02 - abs(f.area_frac - 0.014)) * 40.0 + 0.6 * max(0.0, f.aspect - 1.4)
        scores["Closet"] += 2.6 * (0.012 - f.area_frac) * 80.0 + 0.4 * f.aspect
        scores["Store"] += 1.8 * (0.015 - f.area_frac) * 50.0
        scores["Balcony"] += 3.8 * (0.09 - f.edge_dist) * 12.0 + 1.2 * (0.05 - abs(f.area_frac - 0.02)) * 30.0
        scores["Lobby"] += 1.2 * (0.04 - abs(f.area_frac - 0.03)) * 20.0 + 0.5 * (1.0 - f.cy)
        scores["Communal Space"] += 1.4 * f.area_frac * 10.0 + 0.8 * (1.0 - f.compactness)

        if f.area_frac >= 0.10 and f.edge_dist > 0.07:
            scores["Unit"] += 4.5
        if f.area_frac >= 0.045 and f.edge_dist > 0.08:
            scores["Open Living"] += 2.2
        if f.edge_dist < 0.055 and f.area_frac < 0.09:
            scores["Balcony"] += 5.0
        if f.area_frac < 0.007:
            scores["Closet"] += 3.5
            scores["Unit"] -= 4.0
            scores["Open Living"] -= 3.0
        if f.ink_density > 0.18:
            scores["Closet"] += 0.6
            scores["Store"] += 0.4

        probs = _softmax(scores)
        label = max(probs, key=probs.get)
        return label, float(probs[label])
