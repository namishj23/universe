# UniVerse design system

The web app replicates the Claude Design handoff in `docs/design/universe-ui-mockup-design/` exactly. The prototype is `project/design_handoff_universe_web/UniVerse App.dc.html` (markup and inline styles in `<x-dc>`, data and behaviour in `class Component`); its README is the spec. Where the two disagree on a visual value, **the prototype wins**; for endpoints, **`docs/api/openapi.json` wins**.

Everything below lives in `apps/web/src/shell/`. Screens use only these tokens and components. Stylelint (`npm run lint`) fails on a raw colour, font family or font size anywhere except `shell/theme/tokens.css`.

## 1. Tokens (`shell/theme/tokens.css`)

Colours are CSS custom properties on `:root` (light) and `:root[data-theme='dark']`. `ThemeProvider` (`shell/theme/theme.tsx`) sets `data-theme` on `<html>`: it follows `prefers-color-scheme` until the sidebar's Theme toggle stores an override in `localStorage` (`uv-theme`, wrapped in try/catch).

| Token | Use |
| --- | --- |
| `--bg` | page background, sidebar, modal fill |
| `--surface` | cards, tables, unread rows |
| `--raised` | inputs, inner chips, hover row |
| `--ink` | primary text, primary button fill, active nav, 2px focus ring |
| `--ink2` | secondary text |
| `--muted` | labels and meta (4.5:1 on `--bg`) |
| `--faint` | placeholder-level text only, dashed "unconfirmed" borders (under 4.5:1: never for content) |
| `--line` | 1px dividers |
| `--line-strong` | the 1.5px card, table, input and secondary-button border (the look of the design) |
| `--hover` | hover fill |
| `--inv-bg` / `--inv-fg` / `--inv-raised` / `--inv-muted` | inverted blocks: today's column, login brand panel, toast |
| `--onfill` | text on a module hue fill |
| `--skel` | skeleton blocks |
| `--link` | links |
| `--ok` `--ok-bg`, `--warn` `--warn-bg`, `--err` `--err-bg` | the only red, amber and green: status and errors |
| `--scrim` | modal and drawer backdrop |
| `--ha` … `--he`, `--ha-fill` … `--he-fill` | module hues A–E (the README's `--hA`; lower case for Stylelint) |

**Module hues** are accents only (code letter, dots, the 22×22 code tile, bars). Put `data-mod="<module id>"` on an element and use `var(--mod)` (text) or `var(--mod-fill)` (fills). The ids are `hub`, `rides`, `observatory`, `wellbeing`, `exam`, `admin` (ink) and `platform` (muted). Never put a hue behind body text.

## 2. Type

- `--font-sans` (Familjen Grotesk 400–700) for all UI text. `--font-mono` (Reddit Mono 400–600) **only** for numbers, labels, codes, times, IDs and table data, never sentences. Both are self-hosted with `@fontsource` (imported in `main.tsx`; the CSP blocks third-party fonts).
- Sizes are tokens named by their pixel value: `--fs-76`, `--fs-36`, `--fs-34`, `--fs-30`, `--fs-22`, `--fs-20`, `--fs-19`, `--fs-18`, `--fs-16`, `--fs-15`, `--fs-14-5`, `--fs-14`, `--fs-13-5`, `--fs-13`, `--fs-12-5`, `--fs-12`, `--fs-11-5`, `--fs-11`, `--fs-10-5`, `--fs-10`, `--fs-9-5`. A size not on this list is a design question, not a new token.

| Role | Style |
| --- | --- |
| Login wordmark | sans 76 / 700 / -0.045em, line-height 0.95 |
| Page h1 | sans 34 / 700 / -0.03em |
| Login and forced-change title | sans 30 / 700 / -0.03em |
| Modal title, error title | sans 20 / 700 |
| Empty-state title | sans 22 / 700 / -0.02em |
| Card and row title | sans 14–15 / 600 |
| Body | sans 14 / 400, line-height 1.4–1.5 |
| Help text | sans 12.5–13.5 |
| Eyebrow, field label | mono 11 / 600, UPPERCASE |
| Table header | mono 10.5 / 600, `--muted`, UPPERCASE |
| Big number | mono 30–36 / 500 / -0.03em |

## 3. Spacing, radius, borders

- Steps: 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32 px. Page padding `24px 32px 48px` (`20px 16px 40px` under 1024px); 20px between page sections; card padding 12–18px; grid gaps 12–16px.
- Radius: 2–3 bars and tags · 4 nav items, code tile · 5 buttons · 6 inputs, banners · 8 cards · 10 modals · 15 pill chips · 50% dots.
- Borders: 1.5px `--line-strong` for cards, tables, primary inputs, secondary buttons and the sidebar edge. 1px `--line` for row dividers and inner chips. 1px dashed `--faint` = not confirmed yet. 1.5px dashed `--line-strong` = the empty box.
- No shadows, gradients, glass, emoji, icons or decorative motion. The only animation is the skeleton pulse, off under `prefers-reduced-motion`.

## 4. Components (`shell/ui/`)

| Component | Props and variants | Notes |
| --- | --- | --- |
| `Button` | `variant`: `primary` (ink fill), `secondary` (1.5px border, hover fill), `destructive` (err border/text), `danger` (err fill: the confirm inside a destructive modal), `link` (underlined text). `size`: `sm` 30px, `md` 34px, `modal` 36px, `lg` 36px wide/radius 6, `block` 42px full width | Disabled = opacity 0.4 + `disabled` |
| `Field` | `label` (mono UPPERCASE) wrapping its control | The label is the accessible name |
| `Input` | `large` (40px/15px), `mono`, `invalid` (err border + `aria-invalid`), `readOnly` (1px line, `--bg`, `--ink2`) | 38px, 1.5px border, radius 6 |
| `Select`, `Textarea` | native elements, same styling | Textarea: 1px `--line`, resize vertical |
| `Hint` | `error` turns it red; give it an `id` and point `aria-describedby` at it | Live validation text under a field |
| `FormError` | `role="alert"` | Form-level failure |
| `Chips` | `choices`, `value`, `onChange`, `look`: `pill` (13px), `mono` (11.5px mono), `square` (38px, beside a search box); `tight` = 4px gap | One active (`aria-pressed`), ink fill |
| `Segmented` | `choices`, `value`, `onChange` | One bordered group of mono 12px buttons |
| `TabLinks` | `tabs: { to, label }[]` | Tabs are routes: 3px ink bar overlapping the 1.5px rule, `aria-current="page"` |
| `Table`, `Row`, `TableNote`, `LoadMore` | `columns` (grid template shared by header and rows), `headers`, `minWidth` (scrolls inside the card below it), `rowPad`, `align` | Cursor paging is a "Load more" / "Load older" button, never infinite scroll |
| `PageHeader` | `eyebrow`, `title`, `module` (eyebrow in the module hue), `action` (right side), `baseline` (align on the baseline, as the dashboard does), `children` (rendered right after the header: tabs, chips) | Sets the tab title and receives focus after navigation |
| `HeaderMeta` | mono 12 muted text for the header's right side | e.g. the date range |
| `CodeTile` | `module`, `code` | 22×22, module fill, `--onfill` |
| `StatusDot` | `tone`: `ok`, `warn`, `neutral`, `err`; `label` for screen readers | 7px dot |
| `toneClass(tone)` | colour class for status text | Always pass a tone (`neutral` for none) |
| `Loading` | `what` ("your inbox") | 120px block, three 110px cards, two 44px rows, mono "LOADING {WHAT}…", `aria-busy` |
| `Empty` | `title`, `body`, optional `action { label, onClick }`, `label` (default EMPTY) | Dashed 1.5px box, padding 40px 28px |
| `ErrorBox` | `error` (shows `ERROR · {status}` and the API's `request_id`), `what` ("Couldn't load {what}."), `onRetry` ("Try again") | `role="alert"`, err border and fill |
| `Modal` | `open`, `onOpenChange`, `title`, `description`, `narrow` (420px instead of 440px) | Radix Dialog: focus trap, Esc, focus back to the opener |
| `ModalActions` | right-aligned button row | Secondary first, primary last |
| `Drawer` | as `Modal`, plus `side` (`right` 440px; `left` 280px for the mobile menu) and `hideHead` | Closes on Esc, the scrim or "Close" |
| `useToast()` | `toast(message)` shows DONE; `toast(message, 'ERROR')` | Bottom center, `--inv-bg`, 2.6s, `role="status"` |
| `Card`, `CardLabel` (`Widgets.tsx`) | `pad` 12–18, `gap`, `dashed` (1px `--faint`: not confirmed); `CardLabel` mono 11/600 with optional right `meta` | The 1.5px card every module screen uses |
| `Switch` | `label`, `checked`, `onChange` | 34×20 track in the module fill (`data-mod` on an ancestor), `role="switch"` (Wellbeing consent, driver online) |
| `Stepper` | `label`, `value`, `min`, `max` | 38px − value +, each button labelled (Rides SEATS) |
| `ProgressBar` | `percent`, `label` | 8px bar, `--line` track, module fill (Prep tracker, Wellbeing categories) |
| `GoalGrid` | `done`, `total` | 16px cells, done in the module fill (THIS WEEK'S GOAL) |
| `BarChart` | `bars { key, value, label, ratio, highlight }`, `height` 150/170, `summary` (screen-reader text) | Wellbeing LAST 7 DAYS; Rides Savings |
| `KpiCard` | `label`, `value`, `unit`, `note` | Observatory KPI style (Rides Savings and admin Overview) |

Data hooks used by screens: `useModules()` (`GET /api/modules`), `useFeed()` and `useActivity()` (`unread`, `setUnread`, `subscribe(name, fn)` for ephemeral SSE events such as `rides.chat`), `useAuth()` / `useUser()`. Every query goes through `api()` with the query's `signal`. TanStack Query retries only network errors and 5xx.

## 5. Page anatomy

1. **Header** (`PageHeader`): a mono eyebrow (module hue for module screens, e.g. "B · SMART CAMPUS RIDE-POOLING"; muted for platform screens), the h1, and an optional action aligned to the bottom (or baseline).
2. **Tabs or filters** directly under the header (`TabLinks`, `Chips`).
3. **Content**, separated by 20px: cards (1.5px border, radius 8, `--surface`), tables, the week strip.
4. **States** replace only the content area; the header (and anything the design says is always visible, such as Wellbeing's privacy bar or Exam's banner) stays. Every screen has all four: normal, `Loading`, `Empty`, `ErrorBox`. A failing piece of a page (one module summary) shows its own error inline and never fails the page.
5. **Copy**: sentence case, a period at the end of full sentences, mono UPPERCASE labels with "·" separators, numbers in mono. Energy and carbon figures always say "estimate". Exam flags are "flags for human review", never "cheating" or "misconduct".

## 6. Responsive rules

- Designed for 1280px and up; tested at 1440, 1024, 768 and 360.
- **Below 1024px**: the 216px sidebar becomes a sticky top bar (wordmark + "Menu"), which opens the same navigation in a left drawer. Page padding drops to `20px 16px 40px`. The week strip scrolls sideways inside its card (`min-width: 140px` per day). Two-column layouts stack. Tables scroll inside their card (`Table minWidth`).
- **Nothing scrolls the page sideways at 360px.** Absolutely positioned helpers (visually hidden text) must sit inside a positioned ancestor.
- The login and forced-change screens stack the brand panel above the form.

## 7. Accessibility rules

- A visible focus ring (`outline: 2px solid var(--ink); outline-offset: 2px`) on every focusable element (`:focus-visible`). Headings and alerts that receive focus from code show none.
- Skip link, `aria-current` on the active nav item, page titles ("Inbox · UniVerse"), focus moves to the h1 after navigation, and to the alert after a failed sign-in.
- Every control has a visible label that is its accessible name; icons don't exist, so text is always there.
- axe runs in jsdom (`apps/web/test/a11y.test.tsx`) and with colour contrast in Chromium (`tools/design-compare/a11y.spec.ts`). Three design-level contrast exceptions are excluded there and raised with the design team: the `--faint` demo note and "Nothing yet", and inactive user rows at 65% opacity.

## 8. How to build a screen the design does not draw

1. **Find the nearest designed screen** and copy its layout, spacing and copy style. Examples: forced password change follows Login; the Manage user modal follows New user; 403/404 follow the empty state.
2. **Compose only from existing components and tokens.** If something can't be built from them, add a component here first (tokens only, Stylelint-clean), and document it in section 4.
3. **Copy style**: the same eyebrow, h1, label and sentence patterns as section 5. Reuse existing sentences where the meaning is the same.
4. **Give it every state**: loading, empty and error, using the shared components.
5. **Lock it in**: add a case to `tools/design-compare/visual.spec.ts` (light and dark, 1440 and 390), run `npm run test:visual -- --update-snapshots`, look at the new images, and commit them.
6. **In the pull request, name the reference screen** ("Built from: Admin · New user modal").

## 9. How to add your module's screens (Person 2, U2)

- Folder `apps/web/src/modules/<id>/` (`<id>` from `ModuleId` in contracts):
  - `module.ts` (small, loaded with the shell): default-export a `WebModule`:
    - `activityText[type](payload) => string`: plain inbox wording. Start with a lower-case verb to follow the actor's name; a capitalised sentence stands alone.
    - `dashboardCard(data, user) => { big, text, status?, tone? } | null`: the dashboard card from your summary; `null` shows the placeholder.
  - `Page.tsx`: default-export the module's screen. It is lazily loaded as its own chunk and mounted at `/<id>/*` (use nested `<Routes>` for sub-pages). The shell shows it only to roles that `GET /api/modules` lists, and shows 403 to everyone else.
- Without a folder, the shell shows "Coming in the next build" for a listed module.
- **Week strip**: implement `weekItems(user, { from, to }, signal)` in your backend module definition. Return `{ at, allDay?, title, status?: { label, tone }, confirmed, href }[]` (≤ 50, `href` an internal path). The platform places items in the user's time zone. A failure or more than 1.5 s only drops your items.
- **Header**: `<PageHeader eyebrow={AREA.<id>.eyebrow} title=… module="<id>">`. The eyebrows and titles are in `shell/modules.ts` (`AREA`).
- **States**: `Loading`, `Empty`, `ErrorBox`. **Live data**: `useActivity().subscribe('<id>.<event>', fn)`.

## 10. Checks

| Command | What it guards |
| --- | --- |
| `npm run lint` | ESLint, Prettier, Stylelint (tokens only) |
| `npm test -w @universe/web` | behaviour, states, focus, axe (jsdom) |
| `npm run test:visual` | every screen, role, theme, state and viewport against committed baselines (`tools/design-compare/visual.spec.ts-snapshots/`, macOS Chromium), plus axe with contrast. Update deliberately: `npm run test:visual -- --update-snapshots`, then review every changed image in the diff before committing. |
| `npm run design:compare` | prototype vs build, pixel difference per case, images and table in `docs/sessions/U1-compare/` |
