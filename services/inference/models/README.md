# Model weights directory — do not commit .pt/.pth files

Default overlay models (do not commit .pt files):

    yolo_layout.pt            # GreenMap sheet layout (drawing area / legend / title)
                              # prefetch: scripts/prefetch_layout.py
    mitunet_walls.pth         # MitUNet Mix-Transformer B4 wall masks on the crop
    yolo_walls_obb.pt         # optional GreenMap oriented wall boxes (WALL_BACKEND=yolo)
    architect_floorplan.pt    # optional FloorPlanCAD symbols (USE_ROOM_DETECTOR=true)

Legacy MMDet wall detectors (RMIT research checkpoints):

    cascade_swin_latest.pth   # WALL_BACKEND=cascade_swin
    faster_rcnn_latest.pth    # WALL_BACKEND=faster_rcnn
    retinanet_latest.pth      # WALL_BACKEND=retinanet

Download from Google Drive (weights folder):
https://drive.google.com/drive/folders/1MgW3Qo-8K4OrHi4ebvYd-81cTqQxwLgz

Copy the three `.pth` files into this directory, then pick one in the Detect model dropdown (`wall:faster_rcnn`, `wall:retinanet`, `wall:cascade_swin`) or set `WALL_BACKEND` in `.env`.

These run via **torchvision** weight remapping (no full `mmdet` install). Loading checkpoints requires `mmengine` in the inference venv (`pip install mmengine`, included in `requirements-cpu.txt`).
**floorData** (TensorFlow DeepLabV3+ / UNet — wired into `/v1/detect`):

- Repo: https://github.com/Divak-ar/floorData
- Train with `python main.py` or `UnetModel.ipynb` (UNet recommended by author)
- Copy checkpoints into this folder:
  - `deeplab_walls_best.h5` → Detect model `wall:deeplab`
  - `unet_walls_best.h5` (or notebook name `simple_walls_best.h5`) → `wall:unet_floordata`
- Needs TensorFlow via the dedicated venv `services/inference/.venv-tf` (see `requirements-tensorflow.txt`) for **train and Detect** (`wall:deeplab` / `wall:unet_floordata`); the main inference venv does not need TF installed
- Dataset: [zimhe/pseudo-floor-plan-12k](https://huggingface.co/datasets/zimhe/pseudo-floor-plan-12k)

Binary wall masks are converted to polygons for the Detect overlay (same path as MitUNet).

**Model Studio fine-tune:** pick **MitUNet (Mix-Transformer B4 walls)**, **DeepLabV3+ (floorData)**, or **UNet (floorData)** as the base model.
Training builds/fine-tunes a TensorFlow network from your labelled pages (boxes or polygons → masks) inside `.venv-tf`.
If `deeplab_walls_best.h5` / `unet_walls_best.h5` exist here, training warm-starts from them; otherwise it trains from ImageNet (DeepLab) or random init (UNet).

Check `/health` — `legacy_wall_catalog` shows which files are on disk.

MitUNet weights are downloaded from
https://github.com/aliasstudio/mitunet
on first detect (or copy the .pth next to this README as mitunet_walls.pth).

Optional custom room-seg training from LabelMe (one JSON per page, not a merged file):

    python -m app.yolo.convert_labelme --src C:\Users\gauta\Repo\highlife\data\labelme_dim --out data/yolo_seg --task segment
    python -m app.yolo.train --device cpu --epochs 30

That writes `images/`, `labels/*.txt`, and `data.yaml`. Zip `data/yolo_seg` (or the original LabelMe folder) and upload it in Model Studio.
