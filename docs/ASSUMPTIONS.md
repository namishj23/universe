# Assumptions

Every number here feeds an estimate shown in the app. Module owners add their own section; Person 2 adds Module C's energy and carbon assumptions below.

## Module A · Student Hub (Person 1)

Constants in `apps/api/src/modules/hub/config.ts` (no environment variables).

- **Prep catalogue** (seeded): the design's DSA sheet — Arrays & Strings 50, Linked Lists 20, Trees 30, Graphs 30, Dynamic Programming 35, Greedy 25 (190) — plus Quantitative aptitude 30, Logical reasoning 20, Operating Systems 20, DBMS 20, Computer Networks 20, Mock interviews 5, Resume review 1. Problem counts are demo sizes, not an official sheet.
- **Readiness weights**: DSA 0.5, core 0.2, aptitude 0.15, interview 0.1, resume 0.05 (sum 1). A judgement call for SDE-style placements, not a validated predictor; shown as a progress indicator only.
- **Week**: Sunday 00:00 to Saturday 23:59:59.999 Asia/Kolkata for every module. Default weekly target 20 problems (1–200).
- **Mentor ranking weights**: 0.6 match, 0.2 availability, 0.2 free capacity; match = 0.75 weak-topic coverage + 0.25 interest overlap; 3 weak topics; 4 open slots in 7 days = fully available. Chosen so expertise matters most, then time; not fitted to data.
- **Slots**: 30–180 minutes. Accept without a slot books the earliest open slot at least 60 minutes away. Mentor capacity 0–20, default 3.
- **Term** (mentor dashboard "mentees this term"): Jan–Jun and Jul–Dec, IST.
- **Near capacity** (admin dashboard): current mentees ≥ 80 % of capacity.
- **New resources** (student dashboard): added by anyone in the last 7 days.
- **Idempotency keys** for "+1": remembered 10 minutes, at most 10,000 keys, in one API process.
- **Seeded resource files** are generated, valid PDF/PNG/JPEG files padded to the design's sizes (2.4 MB, 1.1 MB, 640 KB, 3.8 MB, 6.2 MB, 880 KB); their content is a title page, not real notes.

## Module B · Rides (Person 1)

### Stop graph (`apps/api/src/modules/rides/data/graph.json`)

- **22 stops.** 6 from RoutePool (SPIT Gate 2, Azad Nagar, Andheri, Marol Naka, Saki Naka, Ghatkopar), 8 city stops from the team's UI design (Dahisar, Borivali Station, Kandivali, Malad, Goregaon, Jogeshwari, Lokhandwala, Powai) and 8 campus points (SPIT Main Gate, Campus Parking, Main Building, Library, Canteen, Boys Hostel, Girls Hostel, Sports Ground).
- **27 edges, undirected.** The design's main corridor is Borivali → Kandivali → Malad → Goregaon → Jogeshwari → Andheri → Azad Nagar → SPIT. It has branches: Jogeshwari → Lokhandwala → Azad Nagar, and Jogeshwari → Powai (JVLR) → Saki Naka. There are two routes between Jogeshwari and Azad Nagar, and two between Jogeshwari and Saki Naka.
- **Source** (generated once by `node apps/api/scripts/rides-graph.mjs`, then committed):
  - **Coordinates:** OpenStreetMap Nominatim for the city stops. The 6 RoutePool stops keep RoutePool's cached Nominatim coordinates.
  - **Road distances:** OSRM `route` (driving) from the public demo server, averaged over both directions and rounded to whole metres. The 5 RoutePool edges keep RoutePool's cached OSRM distances, so their fares are unchanged.
  - **Usage policy:** both services were called with an identifying User-Agent, at most one request per second. Results are cached in the output file and never fetched at request time.
- **Estimated edges (`estimated: true`).** All 11 campus edges:
  - The campus points are **hand-placed approximations** around Gate 2, because OSM has no data for them.
  - Their edge lengths are the straight-line (haversine) distance × **1.3**.
  - If OSRM fails for a road edge, the script falls back to the same estimate and marks it.
- **Edge kinds:**
  - `road`: public road.
  - `campus_road`: slow lane inside campus (gates ↔ parking).
  - `walk`: footpath. Vehicles are never routed over it, so a stop reachable only on foot (Library, Canteen, hostels, ground, Main Building) can't be a vehicle pickup or drop.
- **Durations.** Distance at these average speeds (`config.graph.speedKmh`): road **20 km/h** (Mumbai traffic), campus road **10 km/h**, walk **5 km/h**. They are not live traffic.
- **One-way roads** are not modelled: there are none in this data.

### Money

- **Auto tariff** (RoutePool's Mumbai rates): ₹27 for the first 1.5 km, then ₹18/km, × 1.2. One half-up rounding to paise.
- **Carpool running cost per km** (`config.offers.costPerKmPaise`), the driver's default, editable per offer:
  - **car ₹7.00/km**: petrol about ₹105/l at about 15 km/l, plus wear;
  - **bike ₹2.50/km**: about 45 km/l, plus wear.
- **Carpool split:** trip cost = planned route metres × cost per km. Each road segment's cost is shared equally by everyone aboard for it. The driver counts as one person for the whole route. Largest-remainder rounding means shares add up exactly.
- **Savings** = the passenger's solo auto fare over their own shortest path, minus their share, never negative per ride.
- **Shared distance:**
  - a pooled rider's trip metres when the group has 2+ riders;
  - a carpool passenger's in-vehicle metres (the driver is aboard the whole way).
- **Occupancy** = people sharing the vehicle: pooled riders, or carpool passengers plus the driver. A paid auto driver is not counted.

### Matching limits (`config.matching`, `config.offers`)

- **Pickup window:** ±10 minutes (RoutePool's buffer), for both ride types.
- **Ranking weights:** 0.7 route similarity, 0.3 time fit (RoutePool's weights), for both ride types.
- **Carpool detour budget:** 2,000 m by default (0–10,000 allowed). The default time budget is the same distance at 20 km/h (6 minutes), capped at 1 hour.
- **Confirmed passengers:** a pickup may move by at most 10 minutes, and a ride may be at most 1.5 × the passenger's direct distance.
- **Trip length:** a driver's own route may take at most 180 minutes.
- **Timing rules:** a cancellation within 15 minutes of departure is audited. A ride can be marked departed from 30 minutes before departure.

## Module D · Digital Wellbeing (Person 1)

- **Idle cap**: 300 s (`DEFAULT_IDLE_CAP_SECONDS`, overridable per call). A gap longer than this without an event counts as idle; time after an `idle` event is idle until the next event.
- **Future events**: up to 24 h ahead is accepted (device clock skew); later is rejected.
- **Time zone**: Asia/Kolkata for days and weeks (configurable in the library; the server uses IST for "today" and retention).
- **Counted by default**: Study, Communication, Social, Entertainment; Other off (as in the design).
- **Retention**: 90 days by default, 7–365. A row is deleted when its date is before today − retention days; uploads older than that are refused.
- **Day cap**: 1440 minutes across all stored categories of a day.
- **Weekly summary**: from Sunday 09:00 IST for the Sunday–Saturday week that just ended; only to users with tracking on or paused and data that week.
- **Default rules** are a starting list of well-known sites, not a classification standard; nothing is distracting until the user marks it.
- **Sample days** in `packages/wellbeing-core/samples/` are synthetic events, hand-checked.
