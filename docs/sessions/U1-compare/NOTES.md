## How to read this

- **1440×900 is the comparison that counts.** The six cases at 0.5% or more are all data the API does not have yet (below). Everything else is under 0.5%. Login, the admin users table, the dashboard's loading/empty/error states and every role's inbox measure 0.00–0.13%.
- **390×844 cannot match by design.** The prototype has no media queries: at 390px it draws the 216px sidebar beside a squeezed main column and a 7-column week. The build follows the README's rule for under 1024px: a top bar with a Menu button, stacked layouts, and a week strip and tables that scroll inside their cards. The 390 numbers (4–50%) measure that layout difference, not drift. They are kept so the images show both layouts side by side.
- Masked (magenta) in both images: request IDs (the error box's `request_id` line and the audit REQUEST column), the prototype's "Any password works…" note and the build's demo note, and the prototype's "viewing as" switcher and the build's account menu.
- The prototype's Google Fonts request is answered with the same `@fontsource` files the build bundles, so glyphs are identical. Both pages run in Chromium at Thu 29 Oct 2026 22:14, Asia/Kolkata, with animations disabled.

## Remaining differences at 1440×900, and why

| Case | Difference | Reason |
| --- | --- | --- |
| dashboard · invigilator · normal | 1.10% | Observatory and Exam have no modules, summaries or contracts yet, so their cards show the placeholder (—, "Coming in the next build.") instead of "43.7 kWh" and "5". The placeholder is one line shorter, so the inbox preview below moves up 18px. The week shows "E · all day" where the prototype says "E · today": the week contract has `time` or `allDay`, nothing else. The Exam nav badge (open flags) needs the exam module. |
| dashboard · admin · normal | 0.64% | Same placeholder cards; plus no Admin card (no admin stats endpoint) and no "§ · 10:00 Weekly audit review" item (`WeekItem.module` must be a module id). |
| dashboard · student / mentor · normal | 0.45–0.48% | Under the bar, but not identical. Hub and Wellbeing summaries are `not_built` until P4/P5 (placeholder cards). The Rides card shows the real rider summary (next ride time) instead of the prototype's match score. The rides inbox line says "their" where the prototype says "her" (we don't use gender). The mentor's "A · now" becomes "A · all day". |
| inbox · admin · empty | 1.10% | On purpose: the admin's announcement card stays visible above the empty box, so an admin with an empty inbox can still announce. The prototype hides it with the rest of the content. |
| admin-audit · empty | 0.44% | Under the bar. The prototype reuses the Users empty copy ("No users match…") on the Audit tab; the build says "No audit entries yet". |
| admin-users · normal | 0.27% | Under the bar. The build adds a `driver` role filter (a real role the API supports), which makes the search input a little narrower. |
| admin-audit · normal | 0.10% | Under the bar. Real action names (`admin.user_password_reset`, `admin.user_updated` instead of the prototype's `admin.password_reset`, `admin.user_deactivated`), and user targets show an id prefix, because the API returns ids, not names. |
| inbox · loading / empty / error | 0.07–0.13% | Under the bar. The filter chips come from loaded events, so while loading, empty or failed only "All" shows; the prototype keeps its sample modules' chips. |
| dashboard · invigilator · empty | 0.30% | Under the bar: the module letters in the sidebar. |
