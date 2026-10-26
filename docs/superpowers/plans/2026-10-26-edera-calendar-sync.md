# Edera Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome MV3 extension that reads the schedule from lk.ederaschool.com and syncs it to a dedicated "Edera" Google calendar.

**Architecture:** A content script on the portal extracts lessons into a normalized `Lesson[]` and messages the service worker. The worker maps lessons to Google events with deterministic IDs, diffs them against the "Edera" calendar, and applies create/update/delete. All logic lives in pure, unit-tested modules; Chrome APIs are touched only in thin entry files.

**Tech Stack:** TypeScript, esbuild (bundling), Vitest (+ v8 LCOV coverage), ESLint, GitHub Actions, SonarCloud.

**Spec:** `docs/superpowers/specs/2026-10-26-edera-calendar-sync-design.md`

## Global Constraints

- Chrome Manifest V3; loaded unpacked; no hosted backend.
- Portal credentials are never stored, logged, or committed; the extension reuses the user's logged-in session.
- Writes only to the calendar named `Edera`; never touches other calendars.
- A failed or empty parse must never delete events.
- Google event IDs are deterministic from the lesson id.
- OAuth client ID lives in `manifest.json` (`oauth2.client_id`), never in logic code. CI needs no secrets except `SONAR_TOKEN`.
- Google API calls are mocked in all automated tests.

## Review Focus

- Schedule with zero lessons (portal glitch or genuinely empty week): no deletions happen.
- Lesson with missing end time: event gets a default 1-hour duration, no crash.
- Timezone: use the timezone from the page/JSON if present, else the browser's; every event carries an explicit `timeZone` (tested in Task 2 mapping).
- Same lesson seen twice in one parse (duplicate rows): deduped by id, one event.
- Lesson rescheduled (same id, new time): updated in place, not duplicated.

---

### Task 1: Scaffold and CI

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`, `public/manifest.json`, `scripts/build.mjs`, `.github/workflows/ci.yml`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: npm scripts `lint`, `typecheck`, `test`, `test:coverage` (writes `coverage/lcov.info`), `build` (writes `dist/` with a loadable extension).

- [ ] **Step 1: Write `tests/smoke.test.ts`** asserting `public/manifest.json` parses, has `manifest_version === 3`, host permission `https://lk.ederaschool.com/*`, and permissions include `identity` and `storage`.
- [ ] **Step 2: Run `npx vitest run`** — Expected: FAIL (no manifest).
- [ ] **Step 3: Create the scaffold.** `manifest.json` declares background service worker `background.js`, content script `content.js` matching the portal, action popup `popup.html`, `oauth2.scopes: ["https://www.googleapis.com/auth/calendar"]` and a placeholder `client_id`. `scripts/build.mjs` bundles `src/background.ts`, `src/content.ts`, `src/popup/popup.ts` with esbuild and copies `public/` into `dist/`.
- [ ] **Step 4: Write `.github/workflows/ci.yml`:** on push and pull_request; Node 20; `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run build`, then `actions/upload-artifact` of `dist/` as `edera-calendar-extension`.
- [ ] **Step 5: Run** `npm run lint && npm run typecheck && npm run test:coverage && npm run build` — Expected: all exit 0, `dist/manifest.json` exists.
- [ ] **Step 6: Commit** `chore: scaffold extension and CI`.

### Task 2: Types and event mapping

**Files:**
- Create: `src/types.ts`, `src/sync/mapping.ts`, `tests/mapping.test.ts`

**Interfaces:**
- Produces (`src/types.ts`):
  - `interface Lesson { id: string; title: string; start: string; end?: string; timeZone: string; location?: string; description?: string }` (`start`/`end` are ISO 8601 local date-times without offset)
  - `interface GCalEvent { id: string; summary: string; start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string }; location?: string; description?: string }`
- Produces (`src/sync/mapping.ts`):
  - `eventId(lessonId: string): string` — lowercase base32hex (`a-v0-9`), length 5–1024, deterministic (hash of lessonId, e.g. SHA-256 truncated; sync version using a small pure implementation).
  - `lessonToEvent(l: Lesson): GCalEvent`

- [ ] **Step 1: Write failing tests:** `eventId('x')` is stable across calls, matches `/^[a-v0-9]{5,1024}$/`, and differs for `'y'`; `lessonToEvent` copies title→summary, keeps timeZone on start and end; missing `end` yields end = start + 1h; (Review Focus: missing end).
- [ ] **Step 2: Run** `npx vitest run tests/mapping.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** both functions.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: lesson to event mapping`.

### Task 3: Diffing

**Files:**
- Create: `src/sync/diff.ts`, `tests/diff.test.ts`

**Interfaces:**
- Consumes: `GCalEvent` (Task 2).
- Produces: `diffEvents(desired: GCalEvent[], existing: GCalEvent[]): { create: GCalEvent[]; update: GCalEvent[]; remove: string[] }` — matches by `id`; `update` only when summary, start, end, location or description differ; `remove` is ids present in `existing` but not `desired`; duplicate ids in `desired` collapse to the first.

- [ ] **Step 1: Write failing tests:** new id → create; changed start (rescheduled) → update, not create+remove; identical → no-op; missing from desired → remove; duplicate desired ids → one create (Review Focus: duplicates, rescheduled).
- [ ] **Step 2–4: Run fail, implement, run pass** (`npx vitest run tests/diff.test.ts`).
- [ ] **Step 5: Commit** `feat: event diffing`.

### Task 4: Portal parser  *(blocked on user-supplied page/JSON sample)*

**Files:**
- Create: `tests/fixtures/schedule-sample.*` (user-provided, scrubbed), `src/reader/parse.ts`, `tests/parse.test.ts`

**Interfaces:**
- Consumes: `Lesson` (Task 2).
- Produces: `parseSchedule(source: string): Lesson[]` — `source` is the raw JSON text or page HTML (decided from the fixture). Dedupes by lesson id. Throws `ParseError` (exported class) when the structure is unrecognizable; returns `[]` only for a recognizably empty schedule.

- [ ] **Step 1: Get the fixture from the user and commit it** after confirming no personal data remains.
- [ ] **Step 2: Write failing tests** asserting exact `Lesson` values for known fixture entries (id, title, start, end, timeZone), that duplicated rows yield one lesson, and that garbage input throws `ParseError`.
- [ ] **Step 3: Run** — Expected: FAIL.
- [ ] **Step 4: Implement `parseSchedule`.** Prefer reading the JSON the page loads; fall back to DOM parsing (via `DOMParser`; use `jsdom` in Vitest env if needed).
- [ ] **Step 5: Run** — Expected: PASS. **Step 6: Commit** `feat: parse portal schedule`.

### Task 5: Google Calendar client

**Files:**
- Create: `src/sync/google.ts`, `tests/google.test.ts`

**Interfaces:**
- Consumes: `GCalEvent`.
- Produces: `class GoogleCalendarClient { constructor(getToken: () => Promise<string>, fetchImpl?: typeof fetch); ensureCalendar(name: string): Promise<string>; listEvents(calendarId: string, timeMin: string, timeMax: string): Promise<GCalEvent[]>; insert(calendarId: string, e: GCalEvent): Promise<void>; patch(calendarId: string, e: GCalEvent): Promise<void>; remove(calendarId: string, eventId: string): Promise<void> }`
- Behavior: `ensureCalendar` finds an existing calendar by `summary === name` in `calendarList`, else creates it; `listEvents` follows `nextPageToken`; on HTTP 401 retries once with a fresh token, other non-2xx throws `GoogleApiError(status, message)`; `insert` treating 409 as success-then-patch.

- [ ] **Step 1: Write failing tests with a fake `fetchImpl`:** reuses existing "Edera" calendar; creates when absent; paginates events; 401 triggers one retry; 500 throws `GoogleApiError`.
- [ ] **Step 2–4: Run fail, implement, run pass.** **Step 5: Commit** `feat: google calendar client`.

### Task 6: Sync orchestration

**Files:**
- Create: `src/sync/sync.ts`, `tests/sync.test.ts`

**Interfaces:**
- Consumes: `Lesson`, `lessonToEvent`, `diffEvents`, `GoogleCalendarClient`.
- Produces: `runSync(lessons: Lesson[], client: GoogleCalendarClient, now: Date): Promise<{ added: number; updated: number; removed: number }>` — syncs the window `[now − 7 days, now + 60 days]`; skips deletion entirely when `lessons.length === 0`.

- [ ] **Step 1: Write failing tests with a fake client:** applies create/update/remove counts correctly; empty `lessons` with existing events performs zero removals (Review Focus); only events inside the window are listed and considered for removal.
- [ ] **Step 2–4: Run fail, implement, run pass.** **Step 5: Commit** `feat: sync orchestration`.

### Task 7: Content script, service worker, triggers

**Files:**
- Create: `src/content.ts`, `src/background.ts`, `src/messages.ts`, `tests/background.test.ts`

**Interfaces:**
- Produces (`src/messages.ts`): `type Msg = { type: 'schedule'; source: string } | { type: 'syncNow' }`; `type SyncState = { status: 'ok' | 'error' | 'loggedOut' | 'idle'; at?: string; added?: number; updated?: number; removed?: number; error?: string }`, stored in `chrome.storage.local` under key `syncState`.
- Behavior: `content.ts` sends the page/JSON source via `{type:'schedule'}` when the portal calendar loads, and sends `loggedOut` state if the login form is detected. `background.ts` handles `schedule` (parse → `runSync` → write `syncState`) and `syncNow` (ask the active portal tab to re-send); `ParseError` and `GoogleApiError` become `status: 'error'` with a message and write nothing. Token via `chrome.identity.getAuthToken`.

- [ ] **Step 1: Write failing tests** for a `handleMessage(msg, deps)` function exported from `background.ts` with injected deps: success writes counts; `ParseError` writes error state and calls no client method.
- [ ] **Step 2–4: Run fail, implement, run pass.** **Step 5: Commit** `feat: content script and service worker`.

### Task 8: Popup UI

**Files:**
- Create: `public/popup.html`, `src/popup/popup.ts`, `tests/popup.test.ts`

**Interfaces:**
- Consumes: `SyncState`, `Msg`.
- Produces: `renderState(s: SyncState): string` (pure; returns the status line text) used by `popup.ts`, which also wires the "Sync now" button to `{type:'syncNow'}`.

- [ ] **Step 1: Write failing tests** for `renderState`: ok → "Last sync … +2 ~1 −0"; loggedOut → prompts user to log in to the portal; error → shows the message.
- [ ] **Step 2–4: Run fail, implement, run pass.** **Step 5: Commit** `feat: popup UI`.

### Task 9: SonarCloud and README

**Files:**
- Create: `sonar-project.properties`, `README.md`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add** `sonar-project.properties` (`sonar.sources=src`, `sonar.tests=tests`, `sonar.javascript.lcov.reportPaths=coverage/lcov.info`) and a `SonarSource/sonarqube-scan-action` step after coverage, using `secrets.SONAR_TOKEN` and `fetch-depth: 0` on checkout.
- [ ] **Step 2: Write `README.md`:** Google Cloud OAuth setup (enable Calendar API, create Chrome Extension client with the unpacked extension ID, paste into `manifest.json`), loading `dist/` in Chrome, adding the Google account in iOS Settings → Calendar → Accounts, SonarCloud setup, no-credentials-in-repo note.
- [ ] **Step 3: Verify** CI passes on the PR with the Sonar step green. **Step 4: Commit** `docs: README and SonarCloud`.

---

## Self-Review Notes
- Spec coverage: reader (4, 7), sync worker (2, 3, 5, 6), auth (5, 7), triggers (7), popup (8), errors (6, 7), testing (all), CI (1, 9). Optional periodic alarm is deferred (YAGNI) and not planned.
- Type names (`Lesson`, `GCalEvent`, `SyncState`, `Msg`) are consistent across tasks.
