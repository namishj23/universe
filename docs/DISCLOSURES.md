# Disclosures

## Reused code

### Module B · Smart Campus Ride-Pooling (rides)

- **Source:** `https://github.com/nishikakhade7/routepool2-react-.git`, branch `frontend-integration`, commit `0c57429` ("Driver portal and a separate staff sign-in"). Exported read-only with `git archive 0c57429 backend`; the source repository was not modified.
- **Authors of the source:** Nishika Khade, namishj23.
- **Ported into:** `apps/api/src/modules/rides/` (CommonJS JavaScript) in P3a. The UI (`frontend-react/`) was not ported; it is rebuilt from the team's design in U2.

| Part | Source file(s) | How it was reused |
| --- | --- | --- |
| Stop graph (6 stops, coordinates, OSRM road distances) | `src/config/stopGraph.js`, `src/config/stopEdges.json` | Copied; distances converted to whole metres (`data/stops.js`) |
| Dijkstra routing | `src/utils/dijkstra.js` | Copied; metres instead of km |
| Free-text stop matching | `src/utils/stopMatcher.js` | Copied unchanged |
| Gender rules (women-only groups, female-driver preference) | `src/utils/genderRules.js` | Copied; field names follow the new schema |
| Matching (eligibility, overlap, ranking) | `src/modules/rides/matching.service.js`, `src/config/matchingConfig.js` | Rules kept; rewritten to load candidates in batched queries (`lib/matching.js`, `services/`) |
| Fares (auto meter tariff, per-segment split) | `src/utils/fare.js` | Rewritten in integer paise with one rounding rule and largest-remainder splitting (`lib/fare.js`) |
| Driver document verification | `src/modules/drivers/verification.js`, `src/config/driverPortal.js` | Copied; field names follow the new schema (`lib/verification.js`) |
| Vehicle checks (documents, inspection, service, complaints) | `src/modules/vehicles/vehicles.service.js`, `src/config/vehicleRules.js` | Pure parts copied (`lib/vehicleStatus.js`); data access rewritten |
| Demo roster and vehicle document offsets | `src/config/drivers.js`, `src/db/mockStore.js` | Copied as seed data (`data/roster.js`) |
| Groups, rides, drivers, vehicles, admin, dashboard services | `src/modules/*/*.service.js` | Behaviour and messages kept; rewritten on the platform (Prisma on the shared database, row locks, transactions, audit log, activity feed, file storage) |
| Check scripts | `scripts/check*.js` | Rewritten as Vitest tests (`apps/api/test/rides/`) |

**Not reused (replaced by the platform):** emailed one-time-code sign-in, staff password sign-in, JWT tokens, `ADMIN_EMAILS`, the mailer, the in-memory mock store (`USE_MOCK_DB`), Module B's own Prisma client, error handler, raw-body document upload and admin action log. `backend/.env` was never read or copied.

### Module E · Exam Review (exam service, `services/exam/`)

| Part | Source / licence | How it was used |
| --- | --- | --- |
| Ultralytics YOLOv8 library and the `yolov8n.pt` / `yolov8n-pose.pt` weights (release v8.2.0) | Ultralytics, AGPL-3.0 | Person and phone detection, pose keypoints for head turns. Weights are downloaded into `ML_DIR`, never committed |
| PyTorch, torchvision | BSD-3-Clause | Runtime for the models (CPU, Apple MPS or CUDA) |
| OpenCV (`opencv-python`) | Apache-2.0 | Reading clips, drawing and encoding snapshots |
| Django, Django REST framework, drf-spectacular | BSD-3-Clause | The service's web framework and API |
| waitress | ZPL-2.1 | Production WSGI server on 127.0.0.1 |
| Kaggle "ExamCheating" image dataset | Kaggle dataset licence | Used only to train the optional, off-by-default posture classifier (`exam_behaviour_cls.pt`); never shipped or committed |
| Four Pexels sample clips (6672346, 6672245, 6672192, 6672378) | Pexels licence (staged with actors) | Demo and hand-checked sample only; not committed |
| A classmate's original exam-monitoring project | Reused with permission | Starting point for the detection idea; heavily changed |
| Person 2's adaptation (`393f5fb`, `7c60584`) | Team code | Detection logic (`FrameAnalyzer`, IoU tracker, head baselines, zone and phone attribution) kept; restructured into this service in E1 |
| Claude Code (Claude Opus 5.5) | AI assistant | Wrote the E1 restructuring, API, tests and docs under Person 1's direction |
