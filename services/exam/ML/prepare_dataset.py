"""Build ML/data_classification/ from the Kaggle ExamCheating_Dataset zip.

The source has five folders; the backend's classifier needs two labels:
  normal      <- "normal act"
  suspicious  <- "looking friend", "giving code", "giving object", "cheating"
"cheating" (12) and "giving object" (15) are too small to learn as classes of their own.

Exact duplicate images (same bytes) are kept once; an image that appears under both a
normal and a suspicious folder has a conflicting label and is dropped. The 80/20
train/val split is stratified per label with a fixed seed so it is reproducible.
The dataset's test/ folder is unlabelled and not used.

Usage (from ML/):  python prepare_dataset.py
"""
import hashlib
import io
import random
import shutil
import zipfile
from collections import defaultdict
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ZIP_PATH = HERE / "datasets" / "exam-cheating-dataset-kaggle.zip"
OUT_DIR = HERE / "data_classification"
VAL_FRACTION = 0.2
SEED = 42

LABEL_MAP = {
    "normal act": "normal",
    "looking friend": "suspicious",
    "giving code": "suspicious",
    "giving object": "suspicious",
    "cheating": "suspicious",
}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def main() -> None:
    by_hash = {}                    # sha1 -> (bytes, suffix, source name)
    labels_by_hash = defaultdict(set)
    skipped_unreadable = 0
    files_read = 0

    with zipfile.ZipFile(ZIP_PATH) as zf:
        for info in zf.infolist():
            parts = info.filename.split("/")
            if info.is_dir() or len(parts) != 4 or parts[1] != "train":
                continue
            folder, name = parts[2], parts[3]
            suffix = Path(name).suffix.lower()
            if folder not in LABEL_MAP or suffix not in IMAGE_SUFFIXES:
                continue
            data = zf.read(info)
            try:
                Image.open(io.BytesIO(data)).verify()
            except Exception:  # noqa: BLE001 - any decode failure means unusable
                skipped_unreadable += 1
                continue
            files_read += 1
            digest = hashlib.sha1(data).hexdigest()
            by_hash.setdefault(digest, (data, suffix, name))
            labels_by_hash[digest].add(LABEL_MAP[folder])

    conflicting = {h for h, labels in labels_by_hash.items() if len(labels) > 1}
    per_label = defaultdict(list)
    for digest, labels in labels_by_hash.items():
        if digest not in conflicting:
            per_label[next(iter(labels))].append(digest)

    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)

    rng = random.Random(SEED)
    summary = {}
    for label, digests in sorted(per_label.items()):
        digests.sort()
        rng.shuffle(digests)
        n_val = round(len(digests) * VAL_FRACTION)
        splits = {"val": digests[:n_val], "train": digests[n_val:]}
        for split, items in splits.items():
            target = OUT_DIR / split / label
            target.mkdir(parents=True, exist_ok=True)
            for digest in items:
                data, suffix, _name = by_hash[digest]
                (target / f"{digest[:16]}{suffix}").write_bytes(data)
        summary[label] = {split: len(items) for split, items in splits.items()}

    print(f"written to {OUT_DIR}")
    for label, counts in summary.items():
        print(f"  {label:<11} train {counts['train']:>4}   val {counts['val']:>4}")
    print(f"unique images: {len(labels_by_hash)}  (exact duplicates merged: "
          f"{files_read - len(labels_by_hash)})")
    print(f"dropped, label conflict normal vs suspicious: {len(conflicting)}")
    print(f"skipped, unreadable: {skipped_unreadable}")


if __name__ == "__main__":
    main()
