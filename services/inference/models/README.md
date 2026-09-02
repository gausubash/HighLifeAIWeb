# Model weights directory — do not commit .pt/.pth files

Default overlay models (do not commit .pt files):

    mitunet_walls.pth         # Detect walls (`wall:mitunet`) — Mix-Transformer B4 + U-Net
    architect_floorplan.pt    # Rooms (`room:architect`), openings (`opening:architect`), fixtures (`object:architect`)
                              # prefetch: scripts/prefetch_architect.py
    yolo_layout.pt            # Layout tab (`layout:greenmap`) — title / legend / drawing
                              # prefetch: scripts/prefetch_layout.py
    roboflow_cache/
      floorplan-segmentation-imdze/4/weights.onnx  # wall + door + window seg
                              # prefetch: scripts/prefetch_roboflow_floorplan_seg.py

Wall Detect is MitUNet (`wall:mitunet`) or ArchVision Roboflow (`wall:roboflow`). Fine-tune walls, room types, objects, and layout in Model Studio
with the matching dataset purpose (MitUNet, YOLO-seg, YOLO detect, GreenMap layout).

MitUNet weights are downloaded from
https://github.com/aliasstudio/mitunet
on first detect (or copy the .pth next to this README as mitunet_walls.pth).

Optional custom room-seg training from LabelMe (one JSON per page, not a merged file):

    python -m app.yolo.convert_labelme --src C:\Users\gauta\Repo\highlife\data\labelme_dim --out data/yolo_seg --task segment
    python -m app.yolo.train --device cpu --epochs 30

That writes `images/`, `labels/*.txt`, and `data.yaml`. Zip `data/yolo_seg` (or the original LabelMe folder) and upload it in Model Studio.
