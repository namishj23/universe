from ultralytics import YOLO
import argparse
import cv2
import os
import pandas as pd

# -----------------------------
# Model paths
# Usage (from ML/): python video_test.py ../sample_videos/03_copying-classmate_pexels-6672192.mp4
# -----------------------------
HERE = os.path.dirname(os.path.abspath(__file__))

DETECTION_MODEL_PATH = os.path.join(HERE, "weights", "yolov8n.pt")

CLASSIFICATION_MODEL_PATH = os.path.join(HERE, "weights", "exam_behaviour_cls.pt")

_parser = argparse.ArgumentParser()
_parser.add_argument("video")
VIDEO_PATH = _parser.parse_args().video

SAVE_DIR = os.path.join(HERE, "detected_frames")
OUTPUT_CSV = os.path.join(HERE, "final_video_results.csv")

os.makedirs(SAVE_DIR, exist_ok=True)

# -----------------------------
# Check paths
# -----------------------------
if not os.path.exists(DETECTION_MODEL_PATH):
    print(f"Detection model not found: {DETECTION_MODEL_PATH}")
    exit()

if not os.path.exists(CLASSIFICATION_MODEL_PATH):
    print(f"Classification model not found: {CLASSIFICATION_MODEL_PATH}")
    exit()

if not os.path.exists(VIDEO_PATH):
    print(f"Video not found: {VIDEO_PATH}")
    exit()

# -----------------------------
# Load models
# -----------------------------
det_model = YOLO(DETECTION_MODEL_PATH)
cls_model = YOLO(CLASSIFICATION_MODEL_PATH)

det_class_names = det_model.names

print("✅ Detection model loaded")
print("✅ Classification model loaded")
print("Detection classes:", det_class_names)

# -----------------------------
# Open video
# -----------------------------
cap = cv2.VideoCapture(VIDEO_PATH)

if not cap.isOpened():
    print("Error: Could not open video.")
    exit()

fps = cap.get(cv2.CAP_PROP_FPS)
if fps == 0:
    fps = 25

total_frames_in_video = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
if total_frames_in_video <= 0:
    total_frames_in_video = 1  # fallback safeguard for streams without a known length

frame_count = 0
paused = False
results_data = []

# -----------------------------
# YouTube/media-player style seek controls
# -----------------------------
WINDOW_NAME = "Final Exam Surveillance Testing"
SEEK_SECONDS = 5  # how many seconds a single left/right press skips

seek_target_frame = None            # set when a seek is requested (via keys or trackbar drag)
last_programmatic_trackbar_val = 0  # used to tell a user drag apart from our own updates


def on_seek_trackbar(val):
    """Called by OpenCV whenever the seek bar moves (by user drag OR our own code)."""
    global seek_target_frame, last_programmatic_trackbar_val
    if val != last_programmatic_trackbar_val:
        # value changed because the USER dragged the bar
        seek_target_frame = val


cv2.namedWindow(WINDOW_NAME)
cv2.createTrackbar("Seek", WINDOW_NAME, 0, max(total_frames_in_video - 1, 1), on_seek_trackbar)

# -----------------------------
# Classification stability settings
# -----------------------------
CLASSIFICATION_INTERVAL = 10   # run classification every N frames
last_cls_label = "Normal"
last_cls_conf = 0.0

# -----------------------------
# Suspicious counter settings
# -----------------------------
suspicious_counter = 0
SUSPICIOUS_THRESHOLD = 20

# -----------------------------
# Detection confidence
# -----------------------------
DETECTION_CONF = 0.65

print("Starting final video testing...")
print("Controls: SPACE = pause/resume | LEFT/A = back 5s | RIGHT/D = forward 5s")
print("          Drag the 'Seek' bar to jump to any point | ESC = exit\n")

while True:
    render_frame = False

    if seek_target_frame is not None:
        # A seek was requested (arrow keys / A-D / dragging the seek bar)
        target = max(0, min(seek_target_frame, total_frames_in_video - 1))
        cap.set(cv2.CAP_PROP_POS_FRAMES, target)
        frame_count = target
        seek_target_frame = None
        render_frame = True
    elif not paused:
        render_frame = True

    if render_frame:
        ret, frame = cap.read()

        if not ret:
            print("Video finished.")
            break

        current_time = frame_count / fps

        # -----------------------------
        # 1. Classification prediction (every N frames, reuse otherwise)
        # -----------------------------
        if frame_count % CLASSIFICATION_INTERVAL == 0:
            cls_result = cls_model(frame, verbose=False)[0]

            cls_id = cls_result.probs.top1
            cls_conf = cls_result.probs.top1conf.item()
            cls_label = cls_result.names[cls_id]

            last_cls_label = cls_label
            last_cls_conf = cls_conf
        else:
            cls_label = last_cls_label
            cls_conf = last_cls_conf

        # -----------------------------
        # 2. Detection prediction (collect only, don't draw yet)
        # -----------------------------
        det_results = det_model(frame, conf=DETECTION_CONF, verbose=False)
        annotated_frame = frame.copy()

        detection_found = False
        suspicious_object_found = False
        phone_detected = False
        detected_objects = []
        boxes_info = []  # (x1, y1, x2, y2, class_name, conf, is_suspicious_class)

        if det_results[0].boxes is not None and len(det_results[0].boxes) > 0:
            for box in det_results[0].boxes:
                cls = int(box.cls[0])
                conf = float(box.conf[0])
                class_name = det_class_names[cls]

                detected_objects.append(f"{class_name}:{conf:.2f}")
                detection_found = True

                print(f"{class_name} detected at {current_time:.2f} sec with confidence {conf:.2f}")

                # Change names according to your detection classes
                is_suspicious_class = class_name.lower() in ["cell phone", "phone", "chit", "suspicious_object"]

                if is_suspicious_class:
                    suspicious_object_found = True

                if "phone" in class_name.lower():
                    phone_detected = True

                x1, y1, x2, y2 = map(int, box.xyxy[0])
                boxes_info.append((x1, y1, x2, y2, class_name, conf, is_suspicious_class))

        # -----------------------------
        # 3. Suspicious counter update
        # -----------------------------
        if cls_label.lower() == "suspicious":
            suspicious_counter += 1
        else:
            suspicious_counter -= 1

        if suspicious_counter < 0:
            suspicious_counter = 0

        # -----------------------------
        # 4. Final decision
        # -----------------------------
        if phone_detected:
            final_status = "Suspicious"
        elif suspicious_counter >= SUSPICIOUS_THRESHOLD:
            final_status = "Suspicious"
        else:
            final_status = "Normal"

        # -----------------------------
        # 4b. Box the cheating person / object
        # Suspicious-class objects (phone/chit/suspicious_object) are always red.
        # Everything else (e.g. "student") turns red too if the frame's
        # overall final_status is Suspicious, otherwise green.
        # -----------------------------
        for (x1, y1, x2, y2, class_name, conf, is_suspicious_class) in boxes_info:
            if is_suspicious_class or final_status == "Suspicious":
                box_color = (0, 0, 255)  # red
            else:
                box_color = (0, 255, 0)  # green

            cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), box_color, 2)
            cv2.putText(
                annotated_frame,
                f"{class_name} {conf:.2f}",
                (x1, max(y1 - 8, 15)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                box_color,
                2
            )

        # -----------------------------
        # 5. Write text on video frame (Frame & Time only)
        # -----------------------------
        cv2.putText(
            annotated_frame,
            f"Frame: {frame_count}  Time: {current_time:.2f}s",
            (20, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2
        )

        # -----------------------------
        # 6. Save frames only when Suspicious
        # -----------------------------
        if final_status == "Suspicious":
            save_path = os.path.join(SAVE_DIR, f"frame_{frame_count}_{final_status}.jpg")
            cv2.imwrite(save_path, annotated_frame)

        # -----------------------------
        # 7. Store results for CSV
        # -----------------------------
        results_data.append({
            "frame_number": frame_count,
            "time_seconds": round(current_time, 2),
            "classification_label": cls_label,
            "classification_confidence": round(cls_conf, 4),
            "detected_objects": ", ".join(detected_objects),
            "suspicious_object_found": suspicious_object_found,
            "suspicious_counter": suspicious_counter,
            "final_status": final_status
        })

        # Scale 4K sample clips down so the preview window fits on screen
        display_frame = annotated_frame
        if display_frame.shape[1] > 1280:
            scale = 1280 / display_frame.shape[1]
            display_frame = cv2.resize(display_frame, None, fx=scale, fy=scale)
        cv2.imshow(WINDOW_NAME, display_frame)

        # Keep the seek bar synced with playback without re-triggering a seek
        last_programmatic_trackbar_val = frame_count
        cv2.setTrackbarPos("Seek", WINDOW_NAME, frame_count)

        frame_count += 1

    # waitKeyEx (not waitKey & 0xFF) is needed so arrow-key codes aren't truncated
    key = cv2.waitKeyEx(30)

    if key == 27:  # ESC
        print("Stopped by user.")
        break

    elif key == 32:  # SPACE
        paused = not paused
        if paused:
            print("Paused")
        else:
            print("Resumed")

    elif key in (2555904, 65363, ord('d'), ord('D')):  # RIGHT arrow / D -> skip forward
        seek_target_frame = frame_count + int(SEEK_SECONDS * fps)
        print(f"⏩ Forward {SEEK_SECONDS}s")

    elif key in (2424832, 65361, ord('a'), ord('A')):  # LEFT arrow / A -> skip backward
        seek_target_frame = frame_count - int(SEEK_SECONDS * fps)
        print(f"⏪ Backward {SEEK_SECONDS}s")

cap.release()
cv2.destroyAllWindows()

# -----------------------------
# Save CSV after video ends
# -----------------------------
df = pd.DataFrame(results_data)
df.to_csv(OUTPUT_CSV, index=False)

# -----------------------------
# Final video decision
# -----------------------------
if len(df) > 0:
    suspicious_frames = (df["final_status"] == "Suspicious").sum()
    total_frames = len(df)
    suspicious_percentage = (suspicious_frames / total_frames) * 100
else:
    suspicious_frames = 0
    total_frames = 0
    suspicious_percentage = 0

if suspicious_percentage >= 20:
    final_video_status = "Suspicious"
else:
    final_video_status = "Normal"

print("\n✅ Final testing completed")
print("CSV saved as:", OUTPUT_CSV)
print("Detected frames saved in:", SAVE_DIR)
print("Total frames checked:", total_frames)
print("Suspicious frames:", suspicious_frames)
print("Suspicious percentage:", round(suspicious_percentage, 2))
print("Final Video Status:", final_video_status)