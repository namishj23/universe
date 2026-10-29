# Algorithms

Each module owner adds a section. Numbers and limits are in `docs/ASSUMPTIONS.md`.

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
