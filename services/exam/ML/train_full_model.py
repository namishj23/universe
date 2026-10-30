from ultralytics import YOLO
import os

DATA_YAML = r"C:\Users\shrut\Desktop\Exam_surveillancess\Exam_surveillance\ML\dataset.yaml"

if not os.path.exists(DATA_YAML):
    print("❌ dataset.yaml not found")
    exit()

model = YOLO("yolov8n.pt")  

model.train(
    data=DATA_YAML,
    epochs=60,        
    imgsz=640,
    batch=8,
    patience=20,
    device="cpu",
    name="final_model"
)

print("✅ Final model training completed")