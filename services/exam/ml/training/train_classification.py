"""Train the behaviour classifier (normal / suspicious) on data_classification/.

Run prepare_dataset.py first. The trained weights are copied to
weights/exam_behaviour_cls.pt, which is where the backend loads them from.

Usage (from ML/):  python train_classification.py [--epochs 30] [--device 0|cpu]
"""
import argparse
import shutil
from pathlib import Path

import torch
from ultralytics import YOLO

HERE = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--device", default="0" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()

    model = YOLO(str(HERE / "weights" / "yolov8n-cls.pt"))

    model.train(
        data=str(HERE / "data_classification"),
        epochs=args.epochs,
        imgsz=224,
        batch=32,
        patience=10,
        seed=42,
        device=args.device,
        workers=2,
        amp=False,     # AMP self-check downloads yolov8n.pt into the cwd and can hang offline
        project=str(HERE / "runs" / "classify"),
        name="exam_behaviour_cls",
        exist_ok=True,
    )

    best = HERE / "runs" / "classify" / "exam_behaviour_cls" / "weights" / "best.pt"
    shutil.copy2(best, HERE / "weights" / "exam_behaviour_cls.pt")
    print(f"Copied {best} -> weights/exam_behaviour_cls.pt")


# Windows starts data-loader workers by re-importing this file; without the guard each
# worker would start training again.
if __name__ == "__main__":
    main()
