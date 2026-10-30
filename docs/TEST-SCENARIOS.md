# Test scenarios (Person 1: Platform, A · Student Hub, B · Rides, D · Wellbeing)

Every scenario runs against the seeded demo data (`npm run db:seed`, or `npm run demo:reset -- --yes` to start the story again from now). All demo accounts use the `SEED_DEMO_PASSWORD` from `apps/api/.env`. Times are Asia/Kolkata. "Covered by" names the automated test that checks the same thing against `universe_test`. Until U2 builds the module screens, run the steps through the API (`http://localhost:4000/api/docs` while `npm run dev` runs) or `curl`; the platform screens (sign-in, dashboard, inbox, admin) already exist in the web app.

Modules C (Observatory) and E (Exam) are Person 2's and are not in the repo yet.

## Demo data at a glance

| Who | Account | What the seed gives them |
| --- | --- | --- |
| Aarav Mehta (student) | `student@universe.test` | The design's week strip (today "Tracking paused"; tomorrow 08:10 Borivali → SPIT with Diya, confirmed; 17:30 return searching; Saturday "Prep goal ends, 6 left"; Sunday 09:00 weekly summary; Monday 15:30 mentor session with Prof. Neha Iyer at SPIT Main Gate with a ride link). Inbox of five, three unread. DSA 118/190, 14 of 20 this week. Wellbeing today 3 h 32 m, paused. One completed shared ride yesterday. |
| Diya Kulkarni (student) | `student2@universe.test` | Carpool driver (car, 3 seats, women-only off): tomorrow 08:02 Dahisar → SPIT with Aarav and Rahul aboard. Pending mentorship request to Neha that names a slot. |
| Prof. Neha Iyer (mentor) | `mentor@universe.test` | Two pending requests (Diya, Kabir), Aarav's Monday session. Carpool driver: tomorrow 07:55 Borivali → SPIT (auto-accept), and 08:30 from Malad the day after tomorrow (Ishita accepted, Kabir and Aarav requesting). |
| Kabir Shah, Ishita Rao (students) | `kabir.shah@`, `ishita.rao@universe.test` | Carpool drivers: Kabir tomorrow 08:17 Borivali → SPIT and Monday Borivali → SPIT Main Gate arriving about 15:07; Ishita tomorrow 08:04 Dahisar → SPIT. |
| Sneha Patil (student) | `sneha.patil@universe.test` | Female rider with women-only rides on; a forming women-only pooled group. |
| Rahul Verma (student) | `rahul.verma@universe.test` | Seat on Diya's 08:02; a forming pooled auto. |
| Dr. Sameer Joshi, Prof. Kavita Nair, Prof. Arjun Menon (mentors) | `sameer.joshi@`, `kavita.nair@`, `arjun.menon@universe.test` | Mentor slots; Kavita has five mentees (at capacity). |
| Rohan Desai (invigilator) | `invigilator@universe.test` | Sees no Person 1 module. |
| Admin Office (admin) | `admin@universe.test` | Admin screens, announcements, audit log. |
| Auto drivers | `ramesh.patil@drivers.universe.test` and six more | Online autos with verified documents; `kiran.pawar@` (licence expiring), `ganesh.salunkhe@` (no documents). |
| Aditya Rane (inactive student) | `aditya.rane@universe.test` | Shows INACTIVE in admin Users; cannot sign in. |

## Platform (P)

| # | Scenario | Account | Steps | Expected result | Covered by |
| --- | --- | --- | --- | --- | --- |
| P1 | Sign in | Aarav | `POST /api/auth/login` with email and password | 200, httpOnly SameSite=Lax cookie, CSRF token in the body; `GET /api/auth/me` returns Aarav | `auth.test.ts` |
| P2 | Wrong password, then lockout | Aarav | Sign in with a wrong password 5 times, then the right one | Attempts 1–5: 401 "Email or password is incorrect." (same text for an unknown email); the 6th (even correct): 429 for 15 minutes | `auth.test.ts`, `throttle.test.ts` |
| P3 | Inactive account | Aditya Rane | Sign in with the right password | 401, same message as a wrong password | `demo.test.ts` |
| P4 | State change without CSRF | Aarav | `POST /api/activity/read-all` without `X-CSRF-Token` | 403 `CSRF_FAILED` | `auth.test.ts` |
| P5 | Unified dashboard | Aarav | `GET /api/dashboard`, `GET /api/dashboard/week` | Hub, Rides, Wellbeing cards `ok`; the week strip above, each item with an internal `href` | `demo.test.ts`, `storyline.test.ts` |
| P6 | Dashboard survives a failing module | any | A module's provider throws or takes > 1.5 s | That module's entry is `error`/`timeout`; the rest of the page is fine | `dashboard.test.ts`, `integration.test.ts` |
| P7 | Live inbox | Aarav + Admin | Aarav opens the web inbox; admin sends an announcement | It appears in Aarav's inbox without reloading; unread count rises | `stream.test.ts`, `storyline.test.ts` |
| P8 | Student opens an admin route | Aarav | `GET /api/admin/users`, `GET /api/admin/audit` | 403 `FORBIDDEN`; the web app shows the 403 page | `admin-users.test.ts`, `route-guards.test.ts` |
| P9 | Every route has a guard | — | `npm test` | Fails if a route lacks sign-in (except login and health) or role metadata, or if `docs/ROLES.md` is stale | `route-guards.test.ts` |
| P10 | Last admin | Admin | Deactivate or demote the only admin (yourself or via a race) | 409 `CANNOT_CHANGE_SELF` / `LAST_ADMIN` | `admin-users.test.ts` |
| P11 | New account notice | Admin | Create a user in admin Users | Temporary password shown once; every admin's inbox gets "New account: … (role)." | `integration.test.ts` |
| P12 | Audit log | Admin | Open Audit log, filter `auth.*` | Sign-ins, sign-outs, admin actions; append-only (UPDATE/DELETE refused by a trigger); no wellbeing entries | `audit.test.ts`, `storyline.test.ts` |

## A · Student Hub

| # | Scenario | Account | Steps | Expected result | Covered by |
| --- | --- | --- | --- | --- | --- |
| A1 | Prep tracker | Aarav | `GET /api/hub/prep` | DSA 118 of 190 (62 %), "14 of 20 done, 6 left", readiness, 30-day series | `hub/prep.test.ts` |
| A2 | +1 without double counting | Aarav | `POST /api/hub/prep/dsa-dp/increment` twice with the same `Idempotency-Key` | Counted once | `hub/prep.test.ts` |
| A3 | Progress out of range | Aarav | Increment a finished topic | 409 `PROGRESS_OUT_OF_RANGE` (not clamped) | `hub/prep.test.ts` |
| A4 | Mentor ranking | Aarav | `GET /api/hub/mentors` | Neha 0.6663, Sameer 0.5691, Arjun 0.5670, Kavita 0.4234, each with a reason | `hub/ranking.test.ts` |
| A5 | Ranking follows progress | Aarav | +20 on Dynamic Programming, then `GET /api/hub/mentors` | Neha drops from first (DP was her strongest match); Sameer leads | `storyline.test.ts` |
| A6 | Request a mentor | Aarav → Sameer | `POST /api/hub/requests` | 201 pending; Sameer's inbox gets it live; a second live request to the same mentor is 409 `REQUEST_EXISTS` | `hub/requests.test.ts` |
| A7 | Slot race | Two mentors' accepts / two requests for one slot | Accept two requests for the same slot at once | One wins; the other 409 `SLOT_TAKEN` | `hub/requests.test.ts` |
| A8 | Mentor at capacity | Rahul → Kavita | Request Kavita | 409 `MENTOR_FULL` | `hub/requests.test.ts` |
| A9 | Slot at an unknown stop | Neha | `POST /api/hub/slots` with a `locationStopId` that is not a rides stop | 422 `STOP_NOT_FOUND` (also when the rides module is not installed) | `integration.test.ts` |
| A10 | Ride link to a session | Aarav | `GET /api/hub/requests/mine` | The accepted Monday session has `rideLink.href = /rides?to=<SPIT Main Gate>&date=<Monday>&arriveBy=15:15`; sessions at walk-only stops have none | `demo.test.ts`, `integration.test.ts` |
| A11 | Focus minutes, opt-in | Aarav | `GET /api/hub/prep`; turn sharing on (`PUT /api/wellbeing/settings {"shareStudyWithHub":true}`); again | First without `focusStudyMinutesThisWeek`; then with this week's study minutes; nothing else from Wellbeing; Neha never sees it | `integration.test.ts` |
| A12 | Privacy of student profiles | Neha / Sameer | `GET /api/hub/students/<Aarav>` | Neha (Aarav asked her): 200; Sameer (no request): 404 | `hub/profiles.test.ts` |
| A13 | Resource search | Aarav | `GET /api/hub/resources?q=graph alg` | "Graph algorithms, 40 problems"; `q=%` finds nothing | `hub/resources.test.ts` |
| A14 | Upload limits | Aarav | Upload an 11 MB PDF; a `.exe` renamed `.pdf` | 413; 415 (type read from the bytes) | `files.test.ts`, `hub/resources.test.ts` |
| A15 | Drivers and invigilators | Rohan / an auto driver | Any `/api/hub/*` | 403 | `hub/roles.test.ts` |

## B · Rides

| # | Scenario | Account | Steps | Expected result | Covered by |
| --- | --- | --- | --- | --- | --- |
| B1 | Stop graph | any | `GET /api/rides/graph`, `GET /api/rides/route?from=&to=` | 22 stops, 27 edges, branches; shortest path with distance and duration | `rides/graph.test.ts` |
| B2 | Carpool matches | Aarav | `GET /api/rides/offers/matches?requestId=<his 08:10 request>` | Diya first with `booking: accepted` and "1 of 3 seats left"; Kabir (7 min apart) and Ishita eligible with the 0.7 × route + 0.3 × time breakdown; "1 hidden: pickup outside ±10 min" (Neha's 07:55) | `demo.test.ts` |
| B3 | Request to join, driver accepts | Aarav, Kabir | Book Kabir's Monday offer, Kabir accepts | Kabir's inbox: "asked to join"; Aarav's: "accepted you"; the match card now shows `booking: accepted` | `storyline.test.ts`, `rides/offers.test.ts` |
| B4 | Full ride / seat race | Riders on a 2-seat offer | Three riders book at once (auto-accept) | Two 201, one 409 `NO_SEAT`; the offer is `full` and leaves the matches | `rides/offers.test.ts` |
| B5 | Pickup too far from your time | A rider 15 min off the route's pickup | Book the offer | 409 (outside ±10 min); counted as hidden in matches | `rides/offers.test.ts`, `demo.test.ts` |
| B6 | Arrive by | Aarav | `POST /api/rides/requests {pickupNodeId, dropNodeId, arriveBy}` | Pickup = arriveBy − shortest-path driving time (whole minutes); both `pickupTime` and `arriveBy`, or neither: 400 | `integration.test.ts` |
| B7 | Women-only | Sneha / a male rider | Sneha's matches; a male rider tries a women-only group | Sneha sees only women-only groups unless she relaxes her filter; a rider who is not female can neither see nor join a women-only group or offer | `rides/gender.test.ts` |
| B8 | Pooled autos | Rahul, Kabir | `GET /api/rides/matches?rideRequestId=<Kabir's>` | Rahul's forming group from Azad Nagar | `rides/grouping.test.ts` |
| B9 | Savings | Aarav | `GET /api/rides/stats/me` | One completed carpool trip, savings > 0, labelled estimate | `demo.test.ts`, `rides/stats.test.ts` |
| B10 | Driver portal | Ramesh Patil | `GET /api/rides/driver`, accept an assignment | Only his own trips; another driver's trip is 404 | `rides/drivers.test.ts` |
| B11 | Cancellations notify | Aarav, Kabir | Aarav cancels his seat; Kabir cancels his offer | Kabir: "cancelled their seat"; passengers: "cancelled their … ride" | `rides/offers.test.ts` |
| B12 | Admin only | Aarav | `GET /api/rides/admin/stats` | 403 | `route-guards.test.ts`, `rides/admin.test.ts` |

## D · Wellbeing

| # | Scenario | Account | Steps | Expected result | Covered by |
| --- | --- | --- | --- | --- | --- |
| D1 | Today and the week | Aarav | `GET /api/wellbeing/summary` | Today 3 h 32 m, average 4 h 24 m, 20 % under, paused since the seeded hour | `wellbeing/records.test.ts` |
| D2 | Upload while paused | Aarav | `PUT /api/wellbeing/totals` while paused | 409 `TRACKING_PAUSED`; nothing stored | `wellbeing/totals.test.ts` |
| D3 | Resume and upload | Aarav | `POST /tracking {"state":"on"}`, then upload today's totals | 200; summary updates | `storyline.test.ts` |
| D4 | Category not counted | Aarav | Upload `other` (not counted) | 422 `CATEGORY_NOT_COUNTED` | `wellbeing/totals.test.ts` |
| D5 | See my data, export | Aarav | `GET /records`, `GET /export` | Only his rows; `wellbeing-export-YYYY-MM-DD.json` | `wellbeing/records.test.ts`, `storyline.test.ts` |
| D6 | Delete everything | Aarav | `DELETE /api/wellbeing/data {"confirm":"DELETE"}` | 0 records, tracking off; without the confirm: 400 | `wellbeing/records.test.ts`, `storyline.test.ts` |
| D7 | Nobody else | Admin, Neha, a driver | Any `/api/wellbeing/*` for Aarav's data | Admins and drivers 403; Neha sees only her own; no route takes a user id | `wellbeing/roles.test.ts` |
| D8 | Nothing in logs or audit | — | Run D3–D6, read the logs and audit log | Logs show method and route pattern only; audit has no wellbeing entries | `wellbeing/logs.test.ts`, `storyline.test.ts` |
| D9 | Browser-side metrics | — | `packages/wellbeing-core` sample days | Sanitised domains, focus session duration, context switches, distracting time match the committed answers | `packages/wellbeing-core/test/*` |
| D10 | Weekly summary | Aarav | The hourly job on Sunday after 09:00 | One "Your weekly summary is ready. Only you can see it." per week | `wellbeing/jobs.test.ts` |

## Cross-module (I)

| # | Scenario | Steps | Expected result | Covered by |
| --- | --- | --- | --- | --- |
| I1 | Interfaces only | `platform.modules.get('rides' \| 'hub' \| 'wellbeing')` | Only the contract's functions; input/output validated; 500 ms limit → 503 `MODULE_UNAVAILABLE`; `undefined` when not installed | `integration.test.ts` |
| I2 | Wellbeing for others | A mentor calls `studyMinutesThisWeek` for a student | null | `integration.test.ts` |
| I3 | Week strip per role | Week for student, admin, driver, invigilator | Only modules the role may use; invigilator none | `integration.test.ts` |
| I4 | Missing module | Run without rides | Week works; slots with a stop are 422 | `integration.test.ts` |

## Storyline (S) — the live demo, `apps/api/test/storyline.test.ts`

1. Aarav signs in → dashboard: three cards ok, 3 unread; week strip as seeded.
2. He adds +20 to Dynamic Programming → the mentor ranking reorders (Neha drops from first).
3. He re-books Neha's Monday 15:30 slot (cancel, request with the slot) → Neha's inbox gets it live → Neha accepts → Aarav's inbox gets it live.
4. He opens the session's ride link (`/rides?to=SPIT Main Gate&date=Monday&arriveBy=15:15`) → requests a ride from Borivali with `arriveBy` → finds Kabir's offer to SPIT Main Gate.
5. He asks to join → Kabir sees it live → Kabir accepts → Aarav sees it live; his match card shows JOINED.
6. Wellbeing: resume tracking, upload today's totals, export, delete everything (tracking off, 0 records).
7. The admin announces → Aarav's, Neha's, Kabir's, the admin's and a driver's open streams all receive it.
8. The audit log shows sign-ins and the announcement, and nothing from Wellbeing.

Person 2's hook: when Observatory and Exam ship, their steps go at the end of the storyline through their `publicApi` (marked `it.todo` in the test).
