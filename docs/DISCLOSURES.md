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
