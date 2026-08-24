# Model weights directory — do not commit .pt/.pth files

Default overlay models (do not commit .pt files):

    yolo_layout.pt            # GreenMap sheet layout (drawing area / legend / title)
    mitunet_walls.pth         # MitUNet Mix-Transformer B4 wall masks on the crop
    yolo_walls_obb.pt         # optional GreenMap oriented wall boxes (WALL_BACKEND=yolo)
    architect_floorplan.pt    # optional FloorPlanCAD symbols (USE_ROOM_DETECTOR=true)

MitUNet weights are downloaded from
https://github.com/aliasstudio/mitunet
on first detect (or copy the .pth next to this README as mitunet_walls.pth).

Optional custom room-seg training (not the default overlay):

    python -m app.yolo.convert_labelme --src <path-to-labelme-json>
    python -m app.yolo.train --device cpu --epochs 30
