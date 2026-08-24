from __future__ import annotations

import os
import tempfile
from io import BytesIO
from pathlib import Path

from PIL import Image

_tmp = Path(tempfile.mkdtemp())
os.environ["DATABASE_URL"] = f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["STORAGE_DIR"] = str(_tmp / "storage")
os.environ["API_HOST"] = "127.0.0.1"
os.environ["DETECT_BACKEND"] = "opencv"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def _png_bytes(width: int = 8, height: int = 6) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (width, height), (240, 240, 240)).save(buf, format="PNG")
    return buf.getvalue()


def test_health() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["service"] == "floor-plan-api"


def test_project_not_found_error_shape() -> None:
    r = client.get("/api/projects/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404
    body = r.json()
    assert body["error"]["code"] == "PROJECT_NOT_FOUND"
    assert "message" in body["error"]
    assert "details" in body["error"]


def test_upload_and_mock_scene_graph() -> None:
    created = client.post("/api/projects", json={"name": "Demo"})
    assert created.status_code == 200
    project_id = created.json()["id"]

    upload = client.post(
        "/api/plans/upload",
        data={"projectId": project_id},
        files={"file": ("plan.png", _png_bytes(), "image/png")},
    )
    assert upload.status_code == 200, upload.text
    plan = upload.json()
    plan_id = plan["id"]
    page_id = plan["pages"][0]["id"]

    got = client.get(f"/api/plans/{plan_id}")
    assert got.status_code == 200
    assert got.json()["filename"] == "plan.png"

    run = client.post(
        f"/api/plans/{plan_id}/analysis-runs",
        json={"pageId": page_id, "profile": "manual_demo"},
    )
    assert run.status_code == 200
    run_id = run.json()["id"]
    assert run.json()["status"] == "succeeded"

    status = client.get(f"/api/analysis-runs/{run_id}")
    assert status.status_code == 200

    sg = client.get(f"/api/analysis-runs/{run_id}/scene-graph")
    assert sg.status_code == 200
    graph = sg.json()
    assert graph["schemaVersion"] == "1.0.0"
    assert graph["calibration"]["mmPerPixel"] == 5.0
    types = {e["type"] for e in graph["entities"]}
    assert {"room", "door", "wall", "main_floorplan"} <= types
    assert any(m["kind"] == "room_area" for m in graph["measurements"])
    assert any(rel["type"] == "room_door_access" for rel in graph["relationships"])


def test_detect_endpoint_overlays_classified_rooms() -> None:
    from io import BytesIO

    from PIL import Image, ImageDraw

    image = Image.new("RGB", (420, 260), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((18, 18, 402, 242), outline=(0, 0, 0), width=10)
    draw.line((210, 18, 210, 242), fill=(0, 0, 0), width=10)
    buf = BytesIO()
    image.save(buf, format="PNG")

    r = client.post(
        "/api/detect",
        data={"originalWidth": "420", "originalHeight": "260"},
        files={"file": ("page.png", buf.getvalue(), "image/png")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["modelId"] == "layout_region_clf"
    assert len(body["regions"]) >= 2
    first = body["regions"][0]
    assert first["label"]
    assert first["polygonPx"]
    assert first["bboxPx"]["width"] > 0


def test_upload_png_rasters_and_serves_images() -> None:
    project_id = client.post("/api/projects", json={"name": "Raster"}).json()["id"]
    upload = client.post(
        "/api/plans/upload",
        data={"projectId": project_id},
        files={"file": ("plan.png", _png_bytes(12, 9), "image/png")},
    )
    assert upload.status_code == 200, upload.text
    page = upload.json()["pages"][0]
    assert page["widthPx"] == 12
    assert page["heightPx"] == 9
    assert page["dpi"] == 350
    assert page["sourceFilename"] == "plan.png"

    pages = client.get(f"/api/plans/{upload.json()['id']}/pages")
    assert pages.status_code == 200
    assert len(pages.json()) == 1

    original = client.get(page["originalImageUrl"])
    assert original.status_code == 200
    assert original.headers["content-type"].startswith("image/png")
    assert original.content.startswith(b"\x89PNG")

    preview = client.get(f"/api/pages/{page['id']}/image?variant=preview")
    assert preview.status_code == 200
    assert preview.content.startswith(b"\x89PNG")


def test_upload_pdf_renders_at_350_dpi() -> None:
    import fitz
    from PIL import Image
    from io import BytesIO

    pdf = fitz.open()
    pdf.new_page(width=432, height=288)  # 6×4 in → 2100×1400 px at 350 DPI
    payload = pdf.tobytes()
    pdf.close()

    project_id = client.post("/api/projects", json={"name": "PDF"}).json()["id"]
    upload = client.post(
        "/api/plans/upload",
        data={"projectId": project_id},
        files={"file": ("sheet.pdf", payload, "application/pdf")},
    )
    assert upload.status_code == 200, upload.text
    page = upload.json()["pages"][0]
    assert page["pageNumber"] == 1
    assert page["dpi"] == 350
    assert page["widthPx"] == 2100
    assert page["heightPx"] == 1400

    original = client.get(page["originalImageUrl"])
    preview = client.get(f"/api/pages/{page['id']}/image?variant=preview")
    assert original.status_code == 200
    assert preview.status_code == 200
    orig_img = Image.open(BytesIO(original.content))
    prev_img = Image.open(BytesIO(preview.content))
    assert orig_img.size == (2100, 1400)
    assert max(prev_img.size) <= 512
