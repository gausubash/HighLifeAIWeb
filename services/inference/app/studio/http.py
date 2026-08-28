from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from app.studio.dataset import parse_class_names
from app.studio.local_store import (
    StudioStoreError,
    add_page,
    convert_dataset_pdfs_to_images,
    convert_dataset_to_yolo,
    create_dataset,
    create_dataset_tiles,
    create_job,
    delete_dataset,
    delete_job,
    delete_model,
    delete_page,
    get_active_model,
    get_dataset,
    get_job,
    get_model,
    ingest_uploaded_files,
    job_artifacts_dir,
    labeled_pages_dir,
    link_local_path,
    list_datasets,
    list_jobs,
    list_models,
    read_page_labels,
    read_page_png,
    replace_page_image,
    resolve_labels_path,
    save_labels,
    set_active_model,
    set_page_split,
    unlink_source,
    update_page_size,
    update_dataset_class_names,
)
from app.yolo.classes import CLASS_NAMES

router = APIRouter(prefix="/v1/studio", tags=["studio"])


class CreateDatasetBody(BaseModel):
    name: str = Field(min_length=1)
    task: str = "segment"
    category: str | None = None
    classNames: list[str] | None = None
    class_names: list[str] | None = None


class TrainBody(BaseModel):
    datasetId: str = Field(min_length=8)
    epochs: int = 20
    batch: int = 2
    imgsz: int = 640
    baseModel: str = "yolov8n-seg.pt"
    modelName: str | None = None


class LinkPathBody(BaseModel):
    path: str = Field(min_length=1)
    split: str = "train"


class UnlinkPathBody(BaseModel):
    path: str = Field(min_length=1)


class PageSplitBody(BaseModel):
    split: str = Field(min_length=4)


class UpdateDatasetBody(BaseModel):
    classNames: list[str] | None = None
    class_names: list[str] | None = None


class ActivateBody(BaseModel):
    modelId: str | None = None


class LabelsBody(BaseModel):
    version: str | None = None
    flags: dict | None = None
    shapes: list[dict] = Field(default_factory=list)
    imagePath: str | None = None
    imageWidth: int | None = None
    imageHeight: int | None = None


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "details": {}}},
    )


def _store_error(exc: StudioStoreError) -> JSONResponse:
    code = "NOT_FOUND" if exc.status == 404 else "STUDIO_STORE"
    return _error(exc.status, code, str(exc))


@router.get("/fs", response_model=None)
def studio_browse_fs(path: str | None = None):
    """List folders/files on this PC for the Annotate explorer tree."""
    from app.studio.fs_browse import list_directory

    try:
        return list_directory(path)
    except FileNotFoundError as exc:
        return _error(404, "FS_NOT_FOUND", str(exc))
    except NotADirectoryError as exc:
        return _error(400, "FS_NOT_DIR", str(exc))
    except PermissionError as exc:
        return _error(403, "FS_DENIED", str(exc))


@router.get("/datasets")
def studio_list_datasets() -> dict:
    return {"datasets": list_datasets()}


@router.post("/datasets")
def studio_create_dataset(body: CreateDatasetBody) -> dict:
    from app.studio.model_catalog import DATASET_CATEGORY_DEFAULTS

    category = (body.category or "").strip() or None
    defaults = DATASET_CATEGORY_DEFAULTS.get(category or "", {}) if category else {}
    task = body.task or str(defaults.get("task") or "segment")
    names = body.classNames or body.class_names or defaults.get("class_names") or list(CLASS_NAMES)
    try:
        dataset = create_dataset(
            name=body.name,
            task=task,
            class_names=parse_class_names(names if isinstance(names, list) else list(CLASS_NAMES)),
            category=category,
        )
    except StudioStoreError as exc:
        return _store_error(exc)
    return dataset


@router.get("/datasets/{dataset_id}")
def studio_get_dataset(dataset_id: str) -> dict:
    try:
        return get_dataset(dataset_id)
    except StudioStoreError as exc:
        return _store_error(exc)


@router.delete("/datasets/{dataset_id}")
def studio_delete_dataset(dataset_id: str) -> dict:
    try:
        delete_dataset(dataset_id)
    except StudioStoreError as exc:
        return _store_error(exc)
    return {"ok": True}


@router.patch("/datasets/{dataset_id}")
def studio_patch_dataset(dataset_id: str, body: UpdateDatasetBody) -> dict:
    names = body.classNames or body.class_names
    if not names:
        return _error(400, "INVALID_BODY", "classNames is required.")
    try:
        return update_dataset_class_names(dataset_id, parse_class_names(names))
    except ValueError as exc:
        return _error(400, "INVALID_CLASS_NAMES", str(exc))
    except StudioStoreError as exc:
        return _store_error(exc)


@router.post("/datasets/{dataset_id}/link")
def studio_link_path(dataset_id: str, body: LinkPathBody) -> dict:
    try:
        return link_local_path(dataset_id, body.path, split=body.split or "train")
    except StudioStoreError as exc:
        return _store_error(exc)


@router.post("/datasets/{dataset_id}/unlink")
def studio_unlink_path(dataset_id: str, body: UnlinkPathBody) -> dict:
    try:
        return unlink_source(dataset_id, body.path)
    except StudioStoreError as exc:
        return _store_error(exc)


@router.delete("/datasets/{dataset_id}/pages/{page_id}")
def studio_delete_page(dataset_id: str, page_id: str) -> dict:
    try:
        return delete_page(dataset_id, page_id)
    except StudioStoreError as exc:
        return _store_error(exc)


@router.patch("/datasets/{dataset_id}/pages/{page_id}")
def studio_patch_page(dataset_id: str, page_id: str, body: PageSplitBody) -> dict:
    try:
        return set_page_split(dataset_id, page_id, body.split)
    except StudioStoreError as exc:
        return _store_error(exc)


class ConvertPdfBody(BaseModel):
    dpi: int = 300
    pageIds: list[str] | None = None


class CreateTilesBody(BaseModel):
    tileSize: int = 640
    overlap: float = 0.2
    minSide: int | None = None
    onlyLabeled: bool = False
    replaceExisting: bool = True


@router.post("/datasets/{dataset_id}/upload")
async def studio_upload_folder(
    dataset_id: str,
    files: list[UploadFile] = File(...),
    split: str = Form(default="train"),
    dpi: int = Form(default=300),
    convertPdf: str = Form(default="true"),
) -> dict:
    """Upload images and/or PDFs. PDFs can be rasterized at ``dpi`` when convertPdf is true."""
    payloads: list[tuple[str, bytes]] = []
    for upload in files:
        data = await upload.read()
        if not data:
            continue
        name = upload.filename or "file"
        payloads.append((name, data))
    convert = str(convertPdf).strip().lower() not in {"0", "false", "no", "off"}
    try:
        return ingest_uploaded_files(
            dataset_id,
            payloads,
            split=split or "train",
            dpi=int(dpi or 300),
            convert_pdf=convert,
        )
    except StudioStoreError as exc:
        return _store_error(exc)
    except RuntimeError as exc:
        return _error(400, "UPLOAD_FAILED", str(exc))


@router.post("/datasets/{dataset_id}/convert-pdfs")
def studio_convert_pdfs(dataset_id: str, body: ConvertPdfBody) -> dict:
    try:
        return convert_dataset_pdfs_to_images(
            dataset_id,
            dpi=body.dpi,
            page_ids=body.pageIds,
        )
    except StudioStoreError as exc:
        return _store_error(exc)
    except RuntimeError as exc:
        return _error(400, "PDF_CONVERT", str(exc))


@router.post("/datasets/{dataset_id}/pages")
async def studio_add_page(
    dataset_id: str,
    file: UploadFile = File(...),
    sourceName: str = Form(default="page.png"),
    pageNumber: int = Form(default=1),
    labelsJson: str | None = Form(default=None),
) -> dict:
    data = await file.read()
    if not data:
        return _error(400, "EMPTY_FILE", "No page bytes received.")
    labels = None
    if labelsJson:
        try:
            parsed = json.loads(labelsJson)
        except json.JSONDecodeError:
            return _error(400, "BAD_LABELS", "labelsJson is not valid JSON.")
        if isinstance(parsed, dict):
            labels = parsed
    try:
        page = add_page(
            dataset_id,
            image_bytes=data,
            source_name=sourceName or file.filename or "page.png",
            page_number=pageNumber,
            labels=labels,
        )
    except StudioStoreError as exc:
        return _store_error(exc)
    return page


@router.put("/datasets/{dataset_id}/pages/{page_id}/image")
async def studio_replace_page_image(
    dataset_id: str,
    page_id: str,
    file: UploadFile = File(...),
) -> dict:
    data = await file.read()
    if not data:
        return _error(400, "EMPTY_FILE", "No page bytes received.")
    try:
        return replace_page_image(dataset_id, page_id, data)
    except StudioStoreError as exc:
        return _store_error(exc)


@router.put("/datasets/{dataset_id}/pages/{page_id}/labels")
def studio_save_labels(dataset_id: str, page_id: str, body: LabelsBody) -> dict:
    try:
        return save_labels(dataset_id, page_id, body.model_dump())
    except StudioStoreError as exc:
        return _store_error(exc)


@router.get("/datasets/{dataset_id}/pages/{page_id}.png")
def studio_page_png(dataset_id: str, page_id: str):
    try:
        dataset = get_dataset(dataset_id)
        page = next((item for item in dataset["pages"] if item["id"] == page_id), None)
        if not page:
            raise StudioStoreError("Page not found.", 404)
        png, width, height = read_page_png(dataset_id, page)
        if int(page.get("width_px") or 0) != width or int(page.get("height_px") or 0) != height:
            update_page_size(dataset_id, page_id, width, height)
        return Response(content=png, media_type="image/png")
    except StudioStoreError as exc:
        return _store_error(exc)
    except RuntimeError as exc:
        return _error(400, "PDF_RENDER", str(exc))


@router.get("/datasets/{dataset_id}/pages/{page_id}.json")
def studio_page_json(dataset_id: str, page_id: str):
    try:
        dataset = get_dataset(dataset_id)
        page = next((item for item in dataset["pages"] if item["id"] == page_id), None)
        if not page:
            raise StudioStoreError("Page not found.", 404)
        path = resolve_labels_path(dataset_id, page)
        if not path.is_file():
            raise HTTPException(status_code=404, detail="No labels on this page yet.")
        return FileResponse(path, media_type="application/json")
    except StudioStoreError as exc:
        return _store_error(exc)


@router.get("/datasets/{dataset_id}/export.zip")
def studio_export_zip(dataset_id: str):
    try:
        dataset = get_dataset(dataset_id)
        labeled_pages_dir(dataset_id)
    except StudioStoreError as exc:
        return _store_error(exc)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        for page in dataset["pages"]:
            if int(page.get("shape_count") or 0) < 1:
                continue
            page_id = page["id"]
            stem = f"{Path(str(page['source_name'])).stem}-p{page['page_number']}-{page_id[:8]}"
            try:
                png, width, height = read_page_png(dataset_id, page)
            except StudioStoreError:
                continue
            zf.writestr(f"{stem}.png", png)
            labels = read_page_labels(dataset_id, page)
            if labels:
                labels = {
                    **labels,
                    "imagePath": f"{stem}.png",
                    "imageData": None,
                    "imageWidth": labels.get("imageWidth") or width,
                    "imageHeight": labels.get("imageHeight") or height,
                }
                zf.writestr(f"{stem}.json", json.dumps(labels, indent=2))
    filename = f"{dataset['name']}-labelme.zip".replace(" ", "_")
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/datasets/{dataset_id}/create-tiles")
def studio_create_tiles(dataset_id: str, body: CreateTilesBody) -> dict:
    """Slice raster pages into overlapping square tiles for fine-tune imgsz."""
    try:
        return create_dataset_tiles(
            dataset_id,
            tile_size=body.tileSize,
            overlap=body.overlap,
            min_side=body.minSide,
            only_labeled=body.onlyLabeled,
            replace_existing=body.replaceExisting,
        )
    except StudioStoreError as exc:
        return _store_error(exc)


@router.post("/datasets/{dataset_id}/convert-yolo")
def studio_convert_yolo(dataset_id: str) -> dict:
    """Convert LabelMe annotations to YOLO images/labels/data.yaml on this PC."""
    try:
        return convert_dataset_to_yolo(dataset_id)
    except StudioStoreError as exc:
        return _store_error(exc)


@router.get("/datasets/{dataset_id}/export-yolo.zip")
def studio_export_yolo_zip(dataset_id: str):
    """Download the last YOLO export (runs convert first if missing)."""
    try:
        dataset = get_dataset(dataset_id)
        out = Path(dataset["storage_path"] or "") / "_yolo_export"
        if not (out / "data.yaml").is_file():
            convert_dataset_to_yolo(dataset_id)
            out = Path(get_dataset(dataset_id)["storage_path"] or "") / "_yolo_export"
        if not (out / "data.yaml").is_file():
            raise StudioStoreError("YOLO export not found. Convert LabelMe to YOLO first.", 404)
    except StudioStoreError as exc:
        return _store_error(exc)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        for path in sorted(out.rglob("*")):
            if path.is_file():
                zf.write(path, arcname=str(path.relative_to(out)).replace("\\", "/"))
    filename = f"{dataset['name']}-yolo.zip".replace(" ", "_")
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/jobs")
def studio_list_jobs() -> dict:
    return {"jobs": list_jobs()}


@router.get("/jobs/{job_id}")
def studio_get_job(job_id: str):
    try:
        return get_job(job_id)
    except StudioStoreError as exc:
        return _store_error(exc)


@router.get("/jobs/{job_id}/preview.png")
def studio_job_preview(job_id: str):
    """Latest segmentation overlay from training (updated each epoch when possible)."""
    try:
        get_job(job_id)
    except StudioStoreError as exc:
        return _store_error(exc)
    preview = job_artifacts_dir(job_id) / "preview.png"
    if preview.is_file():
        return FileResponse(
            preview,
            media_type="image/png",
            headers={"Cache-Control": "no-store, max-age=0"},
        )
    # Fall back to Ultralytics batch mosaics if preview not ready yet.
    runs = job_artifacts_dir(job_id) / "runs"
    for name in ("train_batch0.jpg", "val_batch0_pred.jpg", "val_batch0_labels.jpg"):
        matches = list(runs.rglob(name)) if runs.is_dir() else []
        if matches:
            return FileResponse(matches[0], media_type="image/jpeg")
    return _error(404, "NO_PREVIEW", "No training preview yet — wait for the first epoch.")


@router.delete("/jobs/{job_id}")
def studio_delete_job(job_id: str) -> dict:
    try:
        delete_job(job_id)
    except StudioStoreError as exc:
        return _store_error(exc)
    return {"ok": True}


@router.post("/datasets/{dataset_id}/validate")
def studio_validate_dataset(dataset_id: str, fold: str | None = None) -> dict:
    """Validate labelled pages as LabelMe against master class list (Phase 4)."""
    from app.yolo.validate_annotations import validate_labelme_dir

    try:
        src = labeled_pages_dir(dataset_id, split=None)
    except StudioStoreError as exc:
        return _store_error(exc)
    report = validate_labelme_dir(src, fold=fold, require_building=bool(fold))
    return {"ok": report.ok, "report": report.to_dict()}


@router.post("/train")
def studio_train(body: TrainBody, background: BackgroundTasks) -> dict:
    from app.studio.dataset import assert_base_model
    from app.studio.train_job import run_local_training_job

    try:
        dataset = get_dataset(body.datasetId)
        labeled_pages_dir(body.datasetId)
        base_model = assert_base_model(dataset["task"], body.baseModel)
    except StudioStoreError as exc:
        return _store_error(exc)
    except ValueError as exc:
        return _error(400, "BAD_BASE_MODEL", str(exc))

    job = create_job(
        {
            "dataset_id": dataset["id"],
            "task": dataset["task"],
            "base_model": base_model,
            "epochs": body.epochs,
            "batch": body.batch,
            "imgsz": body.imgsz,
            "model_name": (body.modelName or "").strip() or None,
        }
    )
    background.add_task(run_local_training_job, job["id"])
    return {"ok": True, "status": "queued", "job": job}


@router.get("/base-models")
def studio_base_models(task: str | None = None) -> dict:
    from app.studio.dataset import list_base_models

    models = list_base_models(task if task in {"detect", "segment"} else None)
    from app.studio.model_catalog import CATEGORY_LABELS, DATASET_CATEGORY_DEFAULTS

    return {
        "models": models,
        "default": {"detect": "yolov8n.pt", "segment": "yolov8n-seg.pt"},
        "categories": [
            {
                "id": key,
                "label": CATEGORY_LABELS.get(key, key),
                "task": value["task"],
                "default_base": value["default_base"],
                "class_names": value["class_names"],
            }
            for key, value in DATASET_CATEGORY_DEFAULTS.items()
        ],
    }


@router.get("/models")
def studio_list_models() -> dict:
    return {"models": list_models(), "active": get_active_model()}


@router.post("/models/activate")
def studio_activate_model(body: ActivateBody) -> dict:
    try:
        if body.modelId:
            get_model(body.modelId)
        set_active_model(body.modelId)
    except StudioStoreError as exc:
        return _store_error(exc)
    return {"ok": True, "active": get_active_model()}


@router.delete("/models/{model_id}")
def studio_delete_model(model_id: str) -> dict:
    try:
        delete_model(model_id)
    except StudioStoreError as exc:
        return _store_error(exc)
    return {"ok": True, "active": get_active_model()}
