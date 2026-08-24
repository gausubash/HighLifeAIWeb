from __future__ import annotations

from io import BytesIO

import numpy as np
from PIL import Image, ImageDraw

from app.detect.classify import RegionClassifier, extract_features
from app.detect.pipeline import detect_with_opencv
from app.detect.regions import ProposedRegion, propose_enclosed_regions


def _two_room_png(width: int = 420, height: int = 260) -> bytes:
    image = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((18, 18, 402, 242), outline=(0, 0, 0), width=10)
    draw.line((210, 18, 210, 242), fill=(0, 0, 0), width=10)
    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def test_propose_finds_two_rooms() -> None:
    rgb = np.asarray(Image.open(BytesIO(_two_room_png())).convert("RGB"))
    regions = propose_enclosed_regions(rgb)
    assert len(regions) >= 2
    areas = sorted((r.area_px for r in regions), reverse=True)
    assert areas[0] > 8_000
    assert areas[1] > 8_000


def test_classifier_balcony_vs_unit() -> None:
    clf = RegionClassifier()
    unit = ProposedRegion(
        polygon=np.array([[80, 80], [500, 80], [500, 400], [80, 400]], dtype=np.float64),
        bbox=(80, 80, 420, 320),
        area_px=420 * 320,
        perimeter_px=2 * (420 + 320),
        mean_gray=240,
        ink_density=0.02,
    )
    balcony = ProposedRegion(
        polygon=np.array([[10, 80], [70, 80], [70, 200], [10, 200]], dtype=np.float64),
        bbox=(10, 80, 60, 120),
        area_px=60 * 120,
        perimeter_px=2 * (60 + 120),
        mean_gray=245,
        ink_density=0.03,
    )
    unit_label, unit_p = clf.predict(extract_features(unit, page_width=900, page_height=600))
    bal_label, bal_p = clf.predict(extract_features(balcony, page_width=900, page_height=600))
    assert unit_label in {"Unit", "Open Living"}
    assert unit_p > 0.2
    assert bal_label == "Balcony"
    assert bal_p > 0.2


def test_detect_page_regions_returns_classified_polygons() -> None:
    result = detect_with_opencv(_two_room_png(), original_width=420, original_height=260)
    assert result.width_px == 420
    assert result.height_px == 260
    assert len(result.regions) >= 2
    for region in result.regions:
        assert region.label
        assert region.type in {"room", "unit_boundary"}
        assert len(region.polygon) >= 3
        assert 0 < region.confidence <= 1
        xs = [p[0] for p in region.polygon]
        ys = [p[1] for p in region.polygon]
        assert min(xs) >= -1
        assert min(ys) >= -1
        assert max(xs) <= 421
        assert max(ys) <= 261
