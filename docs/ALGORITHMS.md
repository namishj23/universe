# Algorithms

Each module owner adds a section. Numbers and limits are in `docs/ASSUMPTIONS.md`.

## Module A · Student Hub (Person 1)

Code: `apps/api/src/modules/hub/` — `ranking.ts` (pure), `mentors.ts` (one candidate query), `prep.ts` (readiness, weekly goal, series), `resources.ts` (search). Weights live in `config.ts`.

### 1. One week for every module

`weekOf(at)` in `packages/contracts/src/week.ts`: Sunday 00:00 to Saturday 23:59:59.999, Asia/Kolkata. India has a fixed +05:30 offset and no daylight saving, so the week is plain arithmetic on the offset: shift to IST, floor to the day, step back `weekday` days. `istDate`, `istDayStart` and `istDateStart` come with it. Every module that talks about "this week" uses it.

### 2. Placement readiness

For each track (DSA, core, aptitude, interview, resume), completion = Σ solved ÷ Σ total over the topics the student tracks in that track; a track with no tracked topics counts 0, so readiness never rewards skipping a track.

```
readiness = 0.5 × DSA + 0.2 × core + 0.15 × aptitude + 0.1 × interview + 0.05 × resume   (shown 0–100)
```

Example (test): DSA 118/190, core 10/40, aptitude none, interview 2/5, resume 1/1 → 0.5 × 0.6211 + 0.2 × 0.25 + 0 + 0.1 × 0.4 + 0.05 × 1 = 0.4505 → **45**. Aarav's seed (DSA only) → 0.5 × 0.6211 → **31**.

### 3. Weekly goal and pace

- done = max(0, Σ deltas since Sunday 00:00 IST). A +1 then a −1 correction counts 0.
- expected = target × (time elapsed in the week ÷ 7 days); status `on_track` when done ≥ expected (or done ≥ target), else `behind`.
- The target is this week's row, else the most recent earlier week's, else 20.

### 4. Progress over time (30-day series)

Worked backwards from today's totals, so the last point always equals the current solved count: bucket each tracked topic's events by IST day, then walk from today to 29 days ago subtracting each day's changes. A topic's events count only from when it was (last) tracked: its row started at 0 then, so untracking and re-tracking a topic never makes an earlier day negative. O(E + 30).

### 5. Mentor ranking (the key algorithm)

```
score = 0.6 × match + 0.2 × availability + 0.2 × (1 − load)
match = 0.75 × weakTopicCoverage + 0.25 × interestOverlap
```

- **Normalise** every tag, interest and topic name before comparing: NFKC, trim, lowercase, collapse spaces, then map a catalogue topic name to its tag ("Dynamic Programming" → "dp"), so expertise "DP" matches the DP topic and an interest written "Dynamic Programming" matches expertise "DP".
- **weakTopicCoverage**: weakness w = 1 − solved/total for each tracked topic. W3 = the 3 tracked topics with the highest w (ties by catalogue order). coverage = Σ w over W3 topics whose tag the mentor lists ÷ Σ w over W3; 0 when nothing is tracked.
- **interestOverlap**: Jaccard similarity |A ∩ B| ÷ |A ∪ B| between the student's interests and the mentor's expertise ∪ interests.
- **availability**: open slots starting in the next 7 days ÷ 4, capped at 1.
- **load**: accepted (not completed) mentees ÷ capacity; 1 when capacity is 0.
- **Visibility**: the student never sees themself; mentors at full capacity (or capacity 0) are hidden unless the student already has a pending or accepted request with them.
- **Ties**: equal scores (within 1e-9) → more open slots → name.
- **Reason** (one line, from the components): "Covers two of your weakest topics: Dynamic Programming and Graphs.", plus "One free slot left this week." / "Currently mentoring 5 students." when they apply.

Hand-worked with the seed (also the unit test, `apps/api/test/hub/ranking.test.ts`). Aarav's weakness: Arrays .12, Linked lists .10, Trees .30, Graphs .4667, DP .6857, Greedy .68 → W3 = DP, Greedy, Graphs, Σ = 1.8324; interests {graphs, dp, system design}.

| Mentor | coverage | Jaccard | match | availability | 1 − load | score |
| --- | --- | --- | --- | --- | --- | --- |
| Prof. Neha Iyer (DP, Graphs, System design; 2 open; 1 of 3) | .6289 | 1 | .7217 | .50 | .6667 | **.6663** |
| Dr. Sameer Joshi (Graphs, Greedy; 1 open; 0 of 3) | .6258 | .25 | .5318 | .25 | 1 | **.5691** |
| Prof. Arjun Menon (Greedy, CN; 4 open; 0 of 3) | .3711 | 0 | .2783 | 1 | 1 | **.5670** |
| Prof. Kavita Nair (Trees, DP, OS; 3 open; 5 of 8) | .3742 | .2 | .3307 | .75 | .375 | **.4234** |

The design mock's numbers (0.92, Kavita third) cannot come from its own data; the weights and seed were not tuned to match it.

**Admin view** (`GET /api/hub/admin/mentors`): the same formula against demand. Weakness per topic = 1 − Σ solved ÷ Σ total over every active student tracking it; W3 over those; interests = the union of students' interests. Full mentors are included.

**Cost:** one SQL statement loads every candidate with correlated sub-selects for mentee count, open-slot count, next three open slots (`json_agg`), 30-day request count and the caller's live request — each an index lookup on `(mentor_id, status, …)`. Scoring is O(M · (T + E)) for M mentors, T = 3 weak topics and E expertise tags, then O(M log M) to sort. A test proves 4 and 9 mentors take the same number of queries.

### 6. Accepting a request safely

One transaction locks the mentor's profile row, then the request row, then the slot row (`SELECT … FOR UPDATE`, always in that order, also in cancel/decline/complete). Under the locks it re-checks: request still pending, mentees < capacity, slot still open and in the future. The slot is the body's `slotId`, else the requested one (409 `SLOT_TAKEN` if gone), else the earliest open slot at least an hour away (409 `NO_OPEN_SLOT`). Two accepts racing for one slot: the second waits for the first's locks, then sees the slot booked → 409 (tested). The database backs it up: a partial unique index (one pending/accepted request per student and mentor), a partial unique index on `(mentor_id, starts_at)` and an exclusion constraint `EXCLUDE USING gist (mentor_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status <> 'cancelled')`, so a cancelled slot frees its time.

### 7. Resource search

- The table has a generated, weighted `tsvector`: title words (as written and English-stemmed) and the subject code at weight A, description words at weight B; GIN index.
- The query is built from letters and digits only, each as a prefix (`graph:* & algo:*`), with the `simple` configuration, so a half-typed word matches ("segmentat" → "segmentation") and no user input is ever tsquery syntax. Wildcards and quotes disappear; a query of only punctuation matches nothing.
- Uploader names match with `ILIKE '%…%'` (with `%`, `_` and `\` escaped) on P2's trigram GIN index on `users.name`.
- One statement: full-text hits UNION ALL name hits, grouped by resource (best rank), joined to the file (size, MIME type) and uploader; ordered by `ts_rank` then newest; cursor `(rank, created_at, id)`. Without `q`: newest first on a partial index `(created_at DESC, id DESC) WHERE deleted_at IS NULL`, cursor `(created_at, id)`.
- Rate limit 60 searches per minute per user (debounced typing).

## Module B · Rides (Person 1)

Code: `apps/api/src/modules/rides/` — `lib/dijkstra.js`, `lib/graph.js`, `lib/offerPlan.js`, `lib/fare.js`, `lib/matching.js` (pooled autos, from RoutePool), `services/offers.js`, `services/stats.js`.

### 1. Shortest paths

- **Graph.** 22 stops, 27 undirected edges, each with integer metres, integer seconds and a kind (`road`, `campus_road`, `walk`).
- **Vehicles** use an adjacency list without `walk` edges. Walking paths are only shown by `GET /api/rides/graph`.
- **Dijkstra with a binary min-heap and lazy deletion** (stale heap entries are skipped when popped). This replaces RoutePool's version, which scanned every node at each step (O(V²)).
  - Cost: **O((V + E) log V)** per source.
  - Ties are broken by node id, so paths are deterministic.
  - Each path returns its node list, metres, and the seconds summed along it.
- **Cache** (`core.loadGraph`):
  - Every call runs one fingerprint query: `md5` over all nodes and edges, about 30 rows.
  - If the fingerprint matches, the in-memory graph is reused; a reseed changes the fingerprint and rebuilds it.
  - Shortest-path trees are cached per source stop in a **bounded LRU** (a `Map`, 256 sources, least recently used dropped).
  - With 22 stops, every tree is computed once. A pair lookup is then O(1) for the distance and O(path length) to rebuild the path.
- **Validation** (`lib/graph.js`). It runs on the committed data when the module loads (startup fails with every problem listed) and on the database graph after the seed. It rejects:
  - unknown nodes;
  - self loops;
  - zero, negative or non-integer weights;
  - duplicate edges in either direction;
  - a disconnected graph;
  - a road network that isn't connected without the walking paths.

### 2. Pooled autos (RoutePool's rules, unchanged)

A rider may join a forming group from the same pickup stop if all three hold:

- pickup times are within ±10 minutes;
- the routes overlap by at least 50 % of the shorter one, counting the common leading stops of the two shortest paths;
- one route is a prefix of the other ("one auto on one line").

Ranking: `0.7 × similarity + 0.3 × (1 − minutesApart / 10)`, where similarity = shared ÷ the longer route.

On the branching graph, riders whose paths share a stretch and then split (e.g. Borivali → Andheri and Borivali → Lokhandwala) are **not** pooled into one auto, because RoutePool's line rule still applies. The carpool matcher below handles shared-then-split routes, within a detour budget.

### 3. Carpool offers: detour-based insertion

- **Offer plan.** An offer is the driver's route origin → destination, with a seat count, a detour budget (metres and seconds) and a cost per km. Its **plan** is the ordered list of stops: origin, the accepted passengers' pickups and drops, then the destination.
- **Shortest-path legs.** Each leg between consecutive stops is a shortest road path. Consecutive equal stops give a 0-metre leg.

**Matching a ride request (pickup P, drop Q, desired time T) against open offers** (`GET /api/rides/offers/matches?requestId=`):

1. **SQL pre-filter, before any graph work.** One query, using the `(status, depart_at)` index:
   - status `open` or `full`;
   - departure in [T − 10 min − 180 min, T + 10 min], then the exact bound: departure + base duration + detour budget ≥ T − 10 min;
   - not the passenger's own offer, and no live or declined booking by them;
   - a `CASE` column labels rows hidden by **seats** (`full`), **women-only** (offer women-only, passenger not female), **not women-only** (the passenger asked for women-only rides) or **driver preference** (the passenger asked for a female driver). The last two can be relaxed with `relaxPreference=true`. Labelled rows are only counted.
2. **Feasibility by insertion.** With k planned stops, try every pickup position i ∈ [0, k] and every drop position j ≥ i, so P always comes before Q: **(k+1)(k+2)/2 = O(k²) candidates**. Each candidate is evaluated in O(k), using cached shortest-path lookups only.

   A candidate is **feasible** only if all of these hold:
   - **detour:** plan metres − base route metres ≤ `maxDetourM`, and plan seconds − base seconds ≤ `maxDetourS`;
   - **delay:** every confirmed passenger's planned pickup moves by ≤ 10 minutes;
   - **ride length:** every passenger's in-vehicle metres (the new one included) ≤ 1.5 × their direct shortest path;
   - **seats:** people aboard ≤ seats on every leg. A seat freed at a drop can be reused by a later pickup.

   The cheapest feasible candidate (fewest plan metres) wins; ties keep the earliest position. The **added detour** is new plan metres − current plan metres. If none is feasible, the shortest candidate's broken rule is the reason (`detour`, `detour_time`, `delay`, `ride_length`, `seats`, `no_route`).

   The pickup time is departure + seconds along the plan to P. If it is more than 10 minutes from T, the offer is counted as hidden ("pickup outside ±10 min").
3. **Score.** The same formula as pooled matching, so both ride types read the same:
   ```
   score = 0.7 × routeSimilarity + 0.3 × timeFit
   overlapRatio    = shared ÷ passenger path metres
   routeSimilarity = shared ÷ max(passenger path metres, driver's current route metres)
   timeFit         = max(0, 1 − minutesApart ÷ 10)
   ```
   - "Shared" means the metres of the passenger's shortest path whose edges lie on the driver's current route **in the same direction**.
   - The components are rounded to 3 decimals before they are combined, so the returned breakdown adds up to the score (within rounding to 0.001).
   - Detour, seats and delay are hard rules, not score terms.
   - Results are sorted: eligible first, then score, departure, id. Identical inputs always give the identical order.

**Complexity per request:**
- one indexed query for m candidate offers in the time window, plus one batched load of them and their accepted bookings;
- O(m · k³) arithmetic, with k ≤ 2 × seats ≤ 12, so at most about 1,700 candidate-stop checks per offer;
- shortest paths: at most V tree computations of O((V+E) log V) when the graph changes, then cache hits.

**Measured:** `apps/api/test/rides/matching-perf.test.ts` matches a request against **200 open offers** in a **median of about 23 ms** (budget 200 ms) on the development Mac, through the full HTTP stack.

### 4. Booking a seat safely

`POST /offers/:id/bookings` (and accept):

- One transaction locks the **offer row** (`SELECT … FOR UPDATE`), then the **request row**.
- Inside the lock it re-checks the offer status and departure, that the request is still open, the passenger's pickup window, and the insertion against the committed plan (seats, detour, delays).
- It then writes the booking, the new plan, the cost split for everyone and the request status.
- Every write locks the offer before the request. Pooled joins lock the group before the request. So there is no lock cycle.
- 3 passengers racing for 2 seats leave exactly 2 accepted (tested).

### 5. Cost split

- **Trip cost:** `divRound(plan metres × cost per km, 1000)` paise.
- **Telescoping costs.** `costAt(m)` is computed once per plan stop. Each segment costs `costAt(end) − costAt(start)`, so the segments always add up to the trip cost.
- **Splitting a segment.** Its cost is shared by the people aboard for the whole segment: the driver (aboard throughout), plus passengers whose pickup is at or before its start and whose drop is at or after its end.
  - Shares are exact integer weights over a common denominator (the lcm of the head counts).
  - Paise are given out by the **largest-remainder** method: ties go to the earlier person (the driver first), and the shares always sum to the trip cost.
  - This is the same code path as RoutePool's pooled-auto split (`lib/fare.js splitBySegments`), with a linear cost instead of the meter.
- **Worked example** (tested):

  | | |
  | --- | --- |
  | Driver's route | Borivali → SPIT, 23,761 m |
  | Rate | ₹7/km |
  | Trip cost | 16,633 paise |
  | Passenger | Malad → Andheri, in the car from 8,866 m to 20,641 m |
  | Shared stretch | 14,449 − 6,206 = 8,243 paise, shared by 2 |
  | Passenger share | **4,121** |
  | Driver share | 12,512 |
  | Solo auto fare (11,775 m) | 25,434 |
  | **Savings** | **21,313 paise** |

### 6. Statistics

`GET /api/rides/stats/me` and `GET /api/rides/admin/stats` run **one SQL query** with these steps:

1. Union the completed pooled rides (RoutePool's completed-ride rule) and the accepted bookings of completed carpool offers.
2. Keep the shared ones: a pooled group with 2+ riders, or any carpool ride.
3. Aggregate totals, a per-week series (IST weeks) and the five busiest pickup → drop pairs.

Every figure is labelled an estimate, and the tariff, cost per km and speeds are returned with it.
