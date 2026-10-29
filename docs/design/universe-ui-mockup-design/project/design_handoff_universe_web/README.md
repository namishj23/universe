# Handoff: UniVerse web app (phases U1–U2)

## Overview
UI design for the UniVerse campus platform (`apps/web`): one signed-in shell with a role-aware sidebar, a unified dashboard ("Your week"), the activity inbox, and screens for every module:

| Code | Module | Folder | Roles that see it |
| --- | --- | --- | --- |
| — | Platform: login, dashboard, inbox, admin | `apps/web/src/shell/` | everyone (admin screen: admin only) |
| A | Student Hub | `apps/web/src/modules/hub/` | student, mentor, admin |
| B | Rides | `apps/web/src/modules/rides/` | student, mentor, admin |
| C | Observatory | `apps/web/src/modules/observatory/` | everyone (assumption, confirm with Person 2) |
| D | Wellbeing | `apps/web/src/modules/wellbeing/` | student, mentor (never admin) |
| E | Exam Review | `apps/web/src/modules/exam/` | invigilator, admin |

The sidebar must be built from `GET /api/modules` (it already returns the modules each role may see), not from a hard-coded list. The prototype hard-codes the table above only for the demo.

## About the design files
The files in this bundle are **design references built in HTML**: prototypes that show the intended look and behaviour. They are not production code to copy. Recreate them in the existing web app (React 19 + Vite + TypeScript + React Router 8, `apps/web`), using its patterns: `apps/web/src/platform/api.ts` (`api()`, CSRF header, `ApiRequestError`) and `auth.tsx` (`useAuth()`). Follow every rule in `CLAUDE.md` (loading/empty/error states on every screen, AbortController, one EventSource per tab, debounced search, no tokens in localStorage).

Open `UniVerse App.dc.html` in a browser to click through. It has three settings: **theme** (light/dark), **dataState** (normal/loading/empty/error, applied to the current screen) and **startOnLogin**. The "viewing as" card at the bottom of the sidebar switches between the four demo roles. That switcher is for the demo only; the real app takes the role from the session.

`UniVerse Directions.dc.html` holds the three directions we explored. **Direction 1c ("Week Strip") was chosen.** Ignore 1a and 1b.

## Fidelity
**High fidelity.** Colors, type, spacing, borders and copy are final. Recreate them exactly. Charts are simple CSS bars; build them with plain divs or SVG, no chart library needed. The exam clip area is a placeholder for a `<video>` element.

## Design tokens
Use CSS custom properties on `:root` / `[data-theme="dark"]` and switch with `data-theme` on `<html>`, defaulting to `prefers-color-scheme`. These are the exact values from the prototype.

### Color
| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#ebe9e3` | `#141516` | page background, sidebar |
| `--surface` | `#f6f5f1` | `#1c1d1f` | cards, tables |
| `--raised` | `#ffffff` | `#232527` | inputs, inner chips, hover row |
| `--ink` | `#1b1d1f` | `#ecebe6` | primary text, primary button fill, active nav |
| `--ink2` | `#45494e` | `#c6c5bf` | secondary text |
| `--muted` | `#55595e` | `#a6a59f` | labels, meta (4.5:1 on bg) |
| `--faint` | `#7d8186` | `#86857f` | placeholder-level text only, dashed borders |
| `--line` | `#cfccc3` | `#34363a` | thin dividers (1px) |
| `--line-strong` | `#1b1d1f` | `#7c7e82` | heavy 1.5px card borders, secondary button borders |
| `--hover` | `#dedbd3` | `#2a2c2f` | hover fill |
| `--inv-bg` / `--inv-fg` | `#1b1d1f` / `#ebe9e3` | `#ecebe6` / `#141516` | inverted blocks: "today" column, login brand panel, exam banner, toast |
| `--inv-raised` | `#2c2f33` | `#d7d5ce` | chips inside inverted blocks |
| `--inv-muted` | `#a9adb2` | `#55595e` | meta text inside inverted blocks |
| `--onfill` | `#ffffff` | `#141516` | text on a module hue fill |
| `--skel` | `#dcd9d1` | `#2a2c2f` | loading skeleton blocks |
| `--link` | `#2f3f9a` | `#a9b6ff` | links |

**Module hues** are small accents only: the letter code, dots, chart bars, the 22×22 code tile on dashboard cards, progress fills. Never a background behind body text, and never red, amber or green.

| Module | Text (light) | Fill (light) | Text (dark) | Fill (dark) |
| --- | --- | --- | --- | --- |
| A Hub (indigo) | `oklch(0.46 0.14 268)` | `oklch(0.52 0.14 268)` | `oklch(0.76 0.11 268)` | `oklch(0.72 0.12 268)` |
| B Rides (teal) | `oklch(0.44 0.09 200)` | `oklch(0.52 0.1 200)` | `oklch(0.78 0.09 200)` | `oklch(0.74 0.1 200)` |
| C Observatory (magenta) | `oklch(0.46 0.15 340)` | `oklch(0.52 0.15 340)` | `oklch(0.76 0.13 340)` | `oklch(0.72 0.14 340)` |
| D Wellbeing (violet) | `oklch(0.44 0.13 300)` | `oklch(0.5 0.13 300)` | `oklch(0.76 0.11 300)` | `oklch(0.72 0.12 300)` |
| E Exam (slate) | `oklch(0.44 0.08 235)` | `oklch(0.5 0.09 235)` | `oklch(0.76 0.07 235)` | `oklch(0.72 0.08 235)` |

Token names: `--hA`/`--hA-fill` … `--hE`/`--hE-fill`.

**Status colors** (the only use of red, amber and green):
| Token | Light | Dark | Meaning |
| --- | --- | --- | --- |
| `--ok` / `--ok-bg` | `#1d5a2a` / `#dcefdf` | `#8fd6a0` / `#1f3324` | confirmed, active, collecting, accepted |
| `--warn` / `--warn-bg` | `#7a4f06` / `#f6e6c4` | `#f0b44c` / `#3a2e17` | searching, paused, waiting, open flag |
| `--err` / `--err-bg` | `#9b2418` / `#f7dcd6` | `#f29a8c` / `#3d1f1a` | errors, destructive actions |

Modal scrim: `rgba(20,21,22,0.45)`.

### Typography
- **Familjen Grotesk** (Google Fonts, 400/500/600/700) for all UI text, body copy and forms.
- **Reddit Mono** (Google Fonts, 400/500/600) **only** for numbers, labels, codes, times, IDs, emails in tables and data values. Never for sentences.

| Role | Font | Size / weight / tracking |
| --- | --- | --- |
| Login wordmark | Familjen | 76px / 700 / -0.045em, line-height 0.95 |
| Page title (h1) | Familjen | 34px / 700 / -0.03em |
| Login title | Familjen | 30px / 700 / -0.03em |
| Section heading in a card, modal title | Familjen | 20–22px / 700 / -0.02em |
| Sidebar wordmark | Familjen | 19px / 700 / -0.02em |
| Card title, row title | Familjen | 14–15px / 600 |
| Body | Familjen | 14px / 400, line-height 1.4–1.5 |
| Small body, help text | Familjen | 12.5–13.5px / 400 |
| Big number (KPI) | Reddit Mono | 30–36px / 500 / -0.03em |
| Match score | Reddit Mono | 28px / 500 / -0.03em |
| Eyebrow / label (UPPERCASE) | Reddit Mono | 11px / 600 |
| Table header (UPPERCASE) | Reddit Mono | 10.5px / 600, `--muted` |
| Data cell | Reddit Mono | 11.5–13px / 400–500 |

Use `text-wrap: pretty` on paragraphs.

### Spacing, radius, borders
- Spacing steps used: 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32 px. Card padding 12–18px; page padding `24px 32px 48px`; gaps between page sections 20px; grid gaps 12–16px.
- Radius: 2–3px for bars and tags, 4px for nav items and the code tile, 5px for buttons, 6px for inputs and banners, 8px for cards, 10px for modals, 14–15px for pill filter chips, 50% for dots.
- Borders: **1.5px `--line-strong`** for cards, tables, primary inputs, secondary buttons and the sidebar's right edge (this heavy ink line is the look of the direction). 1px `--line` for row dividers and inner chips. Dashed 1px `--faint` marks anything not yet confirmed (a ride still searching, a tentative session). Dashed 1.5px `--line-strong` marks the empty-state box.
- No shadows, gradients, glass effects or emoji.

### Controls
- Primary button: `--ink` fill, `--bg` text, no border, radius 5–6, height 32–42, 13–15px/600.
- Secondary button: transparent, 1.5px `--line-strong` border, `--ink` text; hover `--hover` fill.
- Destructive: 1.5px `--err` border, `--err` text; hover `--err-bg`. The confirm button in the modal uses an `--err` fill.
- Disabled: opacity 0.4 plus the `disabled` attribute.
- Input/select: height 38–40, 1.5px `--line-strong`, radius 6, `--raised` fill, 14–15px. Read-only inputs use a 1px `--line` border, `--bg` fill and `--ink2` text. Invalid fields get an `--err` border and an `--err` hint below.
- Tabs: 14px/600; the active tab is `--ink` with a 3px `--ink` bottom bar overlapping the 1.5px row border; inactive tabs are `--muted`.
- Filter chips: pill, 1.5px `--line-strong`; the active chip is `--ink` fill with `--bg` text.
- Segmented control (Observatory range): one 1.5px bordered group of mono 12px/600 buttons; the active one is `--ink` fill.
- Toggle switch: 34×20 track (on: module hue fill, off: `--line-strong`) with a 16px `--raised` knob; `role="switch"` and `aria-checked`.
- Focus: add a visible `outline: 2px solid var(--ink); outline-offset: 2px` on every focusable element (not drawn in the prototype; required).

## Shell layout
- CSS grid `216px | minmax(0,1fr)`, `min-height: 100vh`.
- **Sidebar** (sticky, full height, padding 16px 12px, gap 20px, right border 1.5px `--line-strong`):
  1. Wordmark "UniVerse" with the mono line "campus platform" below it.
  2. Top nav: Dashboard, Inbox (mono unread count on the right).
  3. Module nav: one row per module from `/api/modules`, as `[mono code letter in module hue] Label [optional mono badge]`. Exam shows its open-flag count.
  4. At the bottom: a Theme toggle row, then the identity card (name 13.5px/600, mono line "viewing as · {role} ▾"). Clicking the card opens a popover above it with the role list (demo only) and **Sign out** in `--err`.
  - Nav item: padding 7px 8px, radius 4, 14px. **Active** item: `--ink` fill and `--bg` text, and its code letter also turns `--bg`.
- **Main**: padding `24px 32px 48px`, a vertical flex with 20px gap. Each screen starts with a header: a mono eyebrow in the module hue (e.g. "B · SMART CAMPUS RIDE-POOLING") and the h1 below it, with an optional action on the right aligned to the baseline.

## Screens

### 1. Login (`/login`)
- Two columns `1.1fr | 1fr`, full height.
- Left (`--inv-bg`): top row has the institute name in mono and the date and time. At the bottom: the 76px wordmark, the tagline "One sign-in for the hub, rides, the observatory, wellbeing and exam review." (18px, `--inv-muted`, max 440px), then a module index with a 1.5px top rule and one row per module: mono code, name 15px/600, who-it's-for in mono on the right.
- Right: a form at most 380px wide, centered: "Sign in" heading, "Use your campus email and password.", EMAIL and PASSWORD (mono labels), full-width primary button (42px).
- Behaviour: the button shows "Signing in…" and is disabled while sending. Any failure shows `Email or password is incorrect.` in an `--err-bg` alert with `role="alert"`, and focus moves to it (same message for a wrong email and a wrong password, per the API). A 429 response shows the server's message in the same alert.
- The "Demo accounts" quick-fill list is for the hackathon demo only; keep it behind a dev or demo flag.

### 2. Dashboard: "Your week" (`/`)
Data: `GET /api/dashboard` (per-module summaries, each `ok`, `error` or `timeout`) plus the activity feed.
- Header: eyebrow "GOOD EVENING, AARAV · THU 29 OCT", h1 "Your week", mono date range on the right.
- **Week strip**: one card with 1.5px border and radius 8, a 7-column grid (`repeat(7, minmax(0,1fr))`), each column at least 176px tall. Today is the first column, inverted (`--inv-bg`); the other columns are separated by 1px `--line`. Each event is a small button (padding 7px 8px, radius 4, `--raised`, 1px border; **dashed** if unconfirmed) with:
  - a mono meta line `{code} · {time}` in the module hue (`--inv-fg` in the today column);
  - a 12.5px title;
  - an optional mono status line `● confirmed` / `● searching` in a status color.
  A day with no events shows "Nothing yet" in `--faint`. Clicking an event opens its module.
- **Module index**: `repeat(auto-fill, minmax(220px,1fr))`, one card per module the user can see. Each card has a header row (module name 14px/600, a 22×22 code tile in the module fill with `--onfill` text) under a 1.5px rule, then a big mono number (30px), one line of detail (13px `--ink2`) and an optional mono status. Hover fill is `--raised`; the whole card is clickable.
  - If a module summary comes back `error` or `timeout`, show the card with "—" as the number and `Couldn't load · retry` in `--err`. Never fail the whole page.
  - Copy differs by role (see the prototype, e.g. mentor Hub "2 · Mentorship requests waiting").
- **Inbox preview**: 1.5px top rule, mono label "INBOX · 3 NEW", an "Open inbox" link, then 3 rows in a grid `70px | 28px | 1fr` (mono time, mono module code in hue, "**Actor** text").

### 3. Inbox (`/inbox`)
Data: `GET /api/activity?limit&cursor`, `POST /api/activity/:id/read`, `POST /api/activity/read-all`, live updates from `EventSource('/api/activity/stream')` (events `activity` and `unread-count`; de-duplicate by id).
- Header: eyebrow "ACTIVITY · LIVE", h1 "Inbox", secondary "Mark all read" button.
- Filter chips: All, then one per module present.
- Admins also get an "ANNOUNCEMENT TO EVERYONE" card: a textarea (max 500 characters, mono counter) and "Send to everyone" (disabled while empty). After sending, show a toast "Sent to N people."
- List: rows in a grid `10px | 28px | 1fr | 80px`: unread dot (`--ink`), module code, text with the mono module name below it, mono time on the right. Unread rows have a `--surface` fill and weight 500. Clicking a row marks it read. Load more with the cursor (a "Load older" button, not infinite scroll).

### 4. Student Hub (A)
Tabs by role:
- student: Prep tracker · Mentors · Resources · Profile
- mentor: Requests · Resources · Profile
- admin: Resources · Mentor ranking

**Prep tracker**: grid `1fr | 300px`.
- Left: a table with columns TOPIC, SOLVED (mono `44/50`), PROGRESS (8px bar in `--hA-fill` on a `--line` track, with a mono %), and a `+1` button.
- Right: an OVERALL card (mono 36px %, "118 of 190 problems on the DSA sheet.") and THIS WEEK'S GOAL (a 20-cell grid where done cells are `--hA-fill`, then "14 of 20 done, 6 left.").

**Mentors** (ranked): an intro line explaining the ranking (expertise match with weak topics, free slots, current load), then one card per mentor in a grid `40px | 1fr | 120px | 150px`:
- mono rank `#1`;
- name and department, a one-line reason, mono expertise tags;
- mono score 22px with slots below it;
- an action button: "Request mentor" (primary), "Requested" (secondary, `--warn` text, click again to cancel) or "Accepted · Mon 15:30" (disabled, `--ok` text).

**Requests** (mentor): cards with the student's name and year, their quoted note and a mono meta line. Decline (secondary) and Accept (primary) buttons; after a decision, a chip: ACCEPTED (`--ok-bg`) or DECLINED (`--hover`).

**Resources**:
- Search input (debounce 250ms; send `q` to the server), subject chips (All, OS, DBMS, CN, DSA), "Upload PDF" primary button (`POST /api/files/hub.resource`: PDF, PNG or JPEG up to 10 MB).
- Table: TITLE (+ mono type tag), SUBJECT (mono, hue A), UPLOADED BY, SIZE, ADDED.
- Empty search shows `No resources match "{q}"` with a hint.
- Upload errors: 413 → "File is larger than 10 MB.", 415 → "Only PDF, PNG or JPEG files.", quota → the server's message.

**Profile**: grid `1fr | 320px`.
- Left: name and email (read-only), branch and year selects, interests input ("USED FOR MENTOR RANKING"), "Save profile".
- Right: CHANGE PASSWORD with current and new password fields. Validate live: 12 to 256 characters and no email local part; show "N more characters needed." or "Must not contain your email name." in `--err`. Under the button: "Signs you out everywhere else."

### 5. Rides (B)
Header right: mono rule summary "MATCH ≥ 50% OVERLAP · ±10 MIN · MAX 3 RIDERS". Tabs: Find a ride · Matches · Offer a ride.

**Find a ride**: grid `1fr | 340px`.
- Form: FROM and TO stop selects, DATE, PICKUP AROUND (mono time). Validation: different stops ("Pick two different stops."). The submit button "Find matches" shows the loading state, then opens Matches.
- Right: YOUR RIDES list. A confirmed ride has a solid border and `--ok` status; a ride still searching has a dashed border and `--warn` "● searching, no match yet".

**Matches**: a summary line (trip and time) plus a mono count, including hidden candidates and the reason ("1 HIDDEN (PICKUP 08:25 IS OUTSIDE ±10 MIN)"). Then a two-column grid:
- **Stop graph** card (left): stops are positioned nodes, edges are lines. Edge styles:
  - your route: 3px solid `--ink`;
  - the selected match's route: 3px dashed `--hB-fill`;
  - shared segments: 5px solid `--hB-fill`;
  - other edges: 1.5px `--line`.
  Nodes are 10px dots (14px for your start and end), filled `--ink` on your route, `--hB-fill` on theirs only, `--raised` otherwise. Mono 10.5px labels. A legend sits top right. Build it in SVG from the stop-graph coordinates in Module B (`stopGraph.js`); the prototype positions are illustrative.
- **Match cards** (right), sorted by score. Clicking a card selects it and redraws the graph. Each card shows:
  - name and role; the route as "Kandivali → … → SPIT Gate" in mono;
  - the mono 28px score with "MATCH SCORE" below it;
  - a **score breakdown** box: `route similarity 0.83 × 0.7 → 0.58` and `time fit 0.90 × 0.3 → 0.27 (1 min apart)`;
  - a mono stats row: detour **+1.2 km**, overlap **100%**, pickup **08:11**, "1 of 3 seats left";
  - a status (`ELIGIBLE` muted, `REQUESTED · WAITING FOR DRIVER` warn, `JOINED · YOU ARE IN THIS CAR` ok) and an action: "Request to join", "Cancel request" or "Joined" (disabled).
  - The breakdown must match Module B's formula (`matchingConfig.js`: 0.7 route similarity + 0.3 time; overlap ≥ 50% of the shorter route; pickup within 10 min; max 3 riders). Show the numbers the API returns; don't recompute them on the client.

**Offer a ride (driver)**: two columns.
- Left: an OFFER A RIDE form with FROM, TO, LEAVING, a SEATS stepper (1–3, never below the number of accepted riders), VEHICLE, and "Publish ride" (becomes "Update ride").
- Right: JOIN REQUESTS with a mono "N OF M SEATS TAKEN" count. Each request card shows the rider, a mono line "pickup {stop} · {time} · score · detour", and Decline/Accept buttons. Accept is disabled when the car is full. After a decision, an ACCEPTED or DECLINED chip.

### 6. Observatory (C)
- Header right: a segmented control TODAY / 7 DAYS / 30 DAYS.
- KPI cards (`auto-fill minmax(200px,1fr)`): ENERGY · ESTIMATE (kWh), CARBON · ESTIMATE (kg CO₂e), AVG UTILISATION (%), IDLE OVER 4 H (machines). Label: mono 11px muted; value: mono 30px with a smaller unit.
- Chart card: a mono title ("HOURLY ENERGY · TODAY (LAST 2 BARS PROJECTED)") and "kWh · ESTIMATE" on the right. 150px of bars with 3px gaps, `--hC-fill`; projected bars in `--line-strong`. A tooltip on hover ("2.9 kWh (estimate)"), and a mono axis with 3 labels below.
- Labs table: LAB (name + mono machine count), kWh (EST.), UTILISATION, IDLE, SUGGESTION (`--warn` when there is something to do, e.g. "14 machines idle over 4 h. Schedule sleep after 19:00.").
- Footnote (always visible): "All energy and carbon figures are estimates: measured utilisation × rated power × time, and energy × 0.71 kg CO₂e per kWh (grid emission factor, estimate)." **Every energy and carbon number says "estimate"** (CLAUDE.md honesty rule).

### 7. Wellbeing (D): student and mentor only
- Header right: mono "ONLY YOU CAN SEE THIS · NOT ADMINS, NOT MENTORS".
- **Privacy bar**, always visible directly under the header, even in loading, empty and error states:
  - a status dot and text: `--ok` "Collecting daily totals" / `--warn` "Paused since 20:00 · nothing is being counted" / `--muted` "Nothing stored · tracking off";
  - buttons: **Pause tracking / Resume tracking** (primary), **See my data**, **Export JSON**, **Delete everything** (destructive).
  - Every privacy action is one click from this screen.
- Content grid `1fr | 1fr | 300px`:
  - TODAY · DAILY TOTALS: mono 36px total, a comparison with the 7-day average, then category bars (Study, Communication, Social, Entertainment, Other) in `--hD-fill`. A category that is switched off shows "off" at 50% opacity.
  - LAST 7 DAYS: a bar chart with mono values above and day letters below; today in `--hD-fill`, other days `--line-strong`.
  - CONSENT · WHAT IS COUNTED: one toggle per category. Footnote: "Stored: one total in minutes per category per day. Never URLs, page titles, app content or messages."
- **See my data**: a 440px right drawer listing exactly the stored records (DATE, CATEGORY, MINUTES), with the record count at the top. Close by clicking the scrim or "Close".
- **Export**: downloads JSON; toast `wellbeing-export-YYYY-MM-DD.json · N records`.
- **Delete everything**: a confirm modal "Delete all wellbeing data?" that states the record count and that it can't be undone. Buttons: "Keep my data" (secondary) and "Delete everything" (`--err` fill). After deleting, tracking pauses and the screen shows the empty state with "Turn on tracking".

### 8. Exam Review (E): invigilator and admin only
- Header: eyebrow "E · RESPONSIBLE EXAMINATION MONITORING", h1 "Flag review", exam select on the right.
- **Banner** (always visible, `--inv-bg`, `role="note"`): mono "READ FIRST", then "Flags are prompts for human review, not evidence. The system never applies a penalty. Nothing happens to a candidate unless an invigilator records a decision with a note."
- Grid `360px | 1fr`:
  - Left: filter chips (Open N, Dismissed N, Resolved N, All), then the flag list. Each row has the signal name 14px/600, the mono status on the right (OPEN `--warn`, DISMISSED muted, RESOLVED ink) and a mono meta line "F-1042 · seat B-17 · 10:42:18 · conf 0.71". The selected row has a 4px left bar in `--hE-fill` and a `--raised` fill.
  - Right, the detail pane:
    - title and a mono ID, roll number and seat line;
    - the clip area (`aspect-ratio 16/7`, dark `#1b1d1f`), replaced by a `<video>` streamed from `/api/files/:id`, with a scrubber where the flagged segment is marked in amber;
    - four mono facts: AT, DURATION, MODEL CONFIDENCE, STATUS;
    - a plain-language explanation that includes common harmless causes;
    - REVIEW NOTE · REQUIRED (textarea);
    - "Dismiss flag" (secondary) and "Resolve, follow up" (primary), both disabled until the note has text. Helper: "Your decision and note are written to the audit log."
  - A closed flag shows the decision line ("DISMISSED BY ROHAN DESAI · 21:40"), the quoted note, the mono "audit: exam.flag_reviewed", and "Reopen".
- **Wording rule**: never use the words "cheating" or "misconduct" anywhere in this module, and never apply a penalty automatically.

### 9. Admin (platform)
- Header right: "New user" primary. Tabs: Users · Audit log.
- **Users**:
  - Search (debounced; `q` goes to `/api/admin/users`) and mono role filter buttons.
  - Table: NAME, EMAIL (mono), ROLE (mono), STATUS (mono ACTIVE `--ok` / INACTIVE muted; inactive rows at 65% opacity), LAST SEEN, and an action (Deactivate / Reactivate). Your own row shows "You", disabled, because the API refuses self-changes and changes to the last admin. Surface `CANNOT_CHANGE_SELF` and `LAST_ADMIN` errors as toasts.
  - Cursor paging.
- **New user** modal: NAME, EMAIL, ROLE. Validation: a name and a valid email; a 409 shows "An account with this email already exists.". On success, the modal switches to "User created" and shows the temporary password once (mono 16px, dashed box) with "They must change it at first sign-in." and a "Done" button.
- **Audit log**: action-prefix chips (all, auth.*, admin.*, exam.*, platform.*) and a table: TIME, ACTOR, ACTION (mono 600), TARGET, REQUEST (mono request id). Footnote: "Append-only. Entries cannot be edited or deleted, by anyone." Cursor paging.

## Shared states (every screen)
The prototype's `dataState` setting shows these for the current screen. The screen header (and the Wellbeing privacy bar and Exam banner) stay visible; only the content area is replaced.
- **Loading**: skeleton blocks in `--skel`: one 120px block, three 110px cards, two 44px rows, all pulsing (`opacity 1 → .45 → 1`, 1.4s ease-in-out, staggered by .15s; turn the pulse off under `prefers-reduced-motion`). Mono caption "LOADING {thing}…", and `aria-busy="true"`.
- **Empty**: a dashed 1.5px `--line-strong` box (padding 40px 28px) with a mono "EMPTY" label, a 22px/700 title, an explanation, and an optional primary action. Copy for each screen is in `SCREEN_TEXT` in the prototype, e.g. Rides: "No rides yet" / "Request a ride or offer seats in your car. Matches appear within seconds." / "Find a ride".
- **Error**: an `--err-bg` box with a 1.5px `--err` border and `role="alert"`, containing:
  - a mono "ERROR · {status}" label;
  - "Couldn't load {thing}.";
  - "The rest of UniVerse still works. Try again, or quote this request ID if it keeps happening.";
  - the mono `request_id` from `ApiErrorBody.error.requestId`;
  - a "Try again" button that refetches.
- **Toast**: bottom center, `--inv-bg`, radius 6, a mono "DONE" label, auto-dismissed after 2.6s, `role="status"`.
- **Modal**: centered on the scrim, 420–440px wide, `--bg` fill, 1.5px border, radius 10, padding 22. Close with Esc and trap focus inside.

## Interactions and behaviour summary
- Navigation: sidebar buttons change the route. Dashboard week events and module cards deep-link to their module. Hover on an interactive card or row: `--raised` fill or an `--ink` border.
- No decorative animation. The only motion is the skeleton pulse. Keep state changes instant.
- Theme follows `prefers-color-scheme` and can be overridden from the sidebar toggle. Store the choice in `localStorage` (a UI preference, not a secret).
- Responsive: designed for 1280px+. Below 1024px, collapse the sidebar into a top bar with a menu button; the week strip scrolls horizontally (`min-width: 140px` per day); two-column layouts stack.

## State and data (per screen)
| Screen | Endpoint(s) | Local state |
| --- | --- | --- |
| Shell | `GET /api/auth/me`, `GET /api/modules`, `GET /api/activity/unread-count`, SSE stream | theme, mobile menu open |
| Dashboard | `GET /api/dashboard`, `GET /api/activity?limit=3` | none |
| Inbox | activity routes above, `POST /api/admin/announcements` (admin) | filter, announcement draft |
| Hub | P4 hub routes (prep, mentors, requests, resources, profile), files API | active tab, search query (debounced), subject filter |
| Rides | P3 rides routes (search, matches, join, offer, requests) | tab, form fields, selected match |
| Observatory | Module C routes (Person 2) | range |
| Wellbeing | P5 routes: totals, consent, pause, export, delete | drawer open, confirm open |
| Exam | Module E routes (Person 2): flags list, flag detail, review | filter, selected flag, note |
| Admin | `/api/admin/users`, `/api/admin/audit` | tab, query, role filter, modal |

## Assets
None. No icons or images are used; module identity comes from the letter codes and hues. Fonts are Familjen Grotesk and Reddit Mono from Google Fonts. Self-host them with `@fontsource/familjen-grotesk` and `@fontsource/reddit-mono`, because the CSP blocks third-party CDNs.

## Files
- `UniVerse App.dc.html`: the interactive prototype (all screens, roles, states, light/dark). Open it in a browser. Markup and inline styles are in the `<x-dc>` block; data and behaviour are in the `class Component` script at the bottom. Its sample data (`MATCHES`, `FLAGS`, `LABS`, `CATS`, `USERS`, `AUDIT`, `SCREEN_TEXT`) is good seed and test data.
- `UniVerse Directions.dc.html`: the explored directions (1c was chosen).
- `support.js`: the runtime both files need to open locally. Not part of the app.
