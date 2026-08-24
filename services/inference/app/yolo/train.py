from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from app.config import Device, get_settings


def train_yolo_seg(
    *,
    data_yaml: Path,
    weights_out: Path,
    epochs: int,
    imgsz: int,
    batch: int,
    device: str,
    model: str,
    project: Path,
    name: str = "layout_seg",
) -> Path:
    from ultralytics import YOLO

    data_yaml = data_yaml.resolve()
    if not data_yaml.is_file():
        raise FileNotFoundError(
            f"{data_yaml} not found. Convert LabelMe first: python -m app.yolo.convert_labelme --src <dir>"
        )

    yolo = YOLO(model)
    yolo.train(
        data=str(data_yaml),
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        device=0 if device == "cuda" else "cpu",
        workers=0,
        project=str(project),
        name=name,
        exist_ok=True,
        patience=max(5, epochs // 3),
        plots=False,
    )
    run_dir = project / name
    best = run_dir / "weights" / "best.pt"
    if not best.is_file():
        last = run_dir / "weights" / "last.pt"
        if not last.is_file():
            raise FileNotFoundError(f"Training finished but no weights in {run_dir / 'weights'}")
        best = last
    weights_out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best, weights_out)
    return weights_out


def main(argv: list[str] | None = None) -> int:
    settings = get_settings()
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Train YOLO-seg on the converted LabelMe dataset (CPU OK)")
    parser.add_argument("--data", type=Path, default=root / "data" / "yolo_seg" / "data.yaml")
    parser.add_argument("--out", type=Path, default=root / "models" / "layout_yolo_seg.pt")
    parser.add_argument("--model", default="yolov8n-seg.pt", help="Ultralytics seg checkpoint to fine-tune")
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=2)
    parser.add_argument("--device", choices=["cpu", "cuda"], default=settings.device.value)
    parser.add_argument("--project", type=Path, default=root / "runs")
    args = parser.parse_args(argv)

    if args.device == "cuda" and settings.device == Device.CPU:
        pass

    dest = train_yolo_seg(
        data_yaml=args.data,
        weights_out=args.out,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        model=args.model,
        project=args.project,
    )
    print(f"Copied best weights → {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
