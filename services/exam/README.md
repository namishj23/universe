# Module E: exam monitoring (as-is, for porting)

Person 2's working Module E, copied unchanged from its standalone Django project so it can be ported into the platform (see the PR description). It is **not** wired into the monorepo: it has its own Django settings, users and database. **Never run its Django migrations against the `universe` database** — Prisma would treat the tables as drift.

## What it does

Upload a clip (or start a live webcam session) and a background worker flags observed events for human review. There is no verdict: each flag is a time span with a confidence score and one snapshot.

| Flag | How |
| --- | --- |
| Head turned away | YOLOv8n-pose keypoints; nose offset from the shoulders (or eyes, when shoulders are out of frame) compared with that student's own usual position; turns within 3 s merge into one flag |
| Restricted zone entry | A student's foot point stays inside a rectangle given at upload (percent of the frame) |
| Mobile phone visible | YOLOv8n COCO class "cell phone", attributed to the student whose box contains it |

The detection logic is in `backend/surveillance/detection.py` (`FrameAnalyzer` and everything it calls) and the webcam loop in `backend/surveillance/live.py`. Neither depends on Django except where it saves flags and progress.

## Run it (macOS, Windows or Linux)

You need Python 3.11. **No training and no training images are needed.**

```bash
cd services/exam/backend
python3.11 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**Models** — put three files in `services/exam/ML/weights/` (create the folder):

| File | Where to get it |
| --- | --- |
| `yolov8n.pt` | https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n.pt |
| `yolov8n-pose.pt` | https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n-pose.pt |
| `exam_behaviour_cls.pt` | Ask Person 2 (3 MB, trained by `ML/train_classification.py`). Required at start-up even though posture flags are off by default |

**Database** — with no `.env` next to this README, Django uses a local SQLite file, which is enough for testing:

```bash
python manage.py migrate
python manage.py createsuperuser
```

**Process a clip from the terminal** (prints the flags):

```bash
python manage.py process_video --file /path/to/clip.mp4 --room A101
python manage.py process_video --file /path/to/clip.mp4 --room A102 --zone 0,40,35,100
```

Sample clips (free, Pexels licence, staged with actors), 10–17 s each:
- normal classroom: https://www.pexels.com/video/people-taking-examination-in-classroom-6672346/
- normal exam: https://www.pexels.com/video/students-having-examination-6672245/
- copying a classmate: https://www.pexels.com/video/a-man-copying-the-answer-of-his-classmate-6672192/
- cheat sheet: https://www.pexels.com/video/student-using-cheat-sheet-6672378/

Expected on the "copying a classmate" clip: one flag, "Head turned away", Student #1, about 00:00:01–00:00:08, 2 turns.

**API** — `python manage.py runserver` serves `/api/...` on port 8000 (JWT login at `/api/auth/login/`). The React screens are not in this folder.

## Live webcam

`POST /api/live/start/` opens camera 0 on the machine running the backend, so the webcam must be on that machine. On macOS, allow your terminal app under System Settings → Privacy & Security → Camera. Settings: `LIVE_CAMERA_INDEX`, `LIVE_ANALYSIS_FPS`, `LIVE_RECORD_FPS`, `LIVE_MAX_MINUTES`.

## Performance

A GPU is optional. On an RTX 3050 (CUDA) live analysis runs at about 8 frames per second; on CPU it is slower but fine for short clips.

## Not included on purpose

`.env`, the database file and its data, uploaded videos and flag snapshots (they show people), model weights, datasets and `venv`.
