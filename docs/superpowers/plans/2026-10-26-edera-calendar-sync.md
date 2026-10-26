# Edera Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome MV3 extension that reads the schedule from lk.ederaschool.com and syncs it to a dedicated "Edera" Google calendar.

**Architecture:** A content script on the portal (a server-rendered 1C-Bitrix site whose calendar is a DayPilot widget) calls the portal's own same-origin JSON endpoints with the user's session cookie: a list endpoint for all lessons, and a per-lesson detail endpoint for student name and meeting info. It normalizes them into `Lesson[]` and messages the service worker. The worker maps lessons to Google events with deterministic IDs, diffs them against the "Edera" calendar, and applies create/update/delete. All logic lives in pure, unit-tested modules; Chrome APIs are touched only in thin entry files.

**Portal facts (verified by logging in, 2026-10-26):**
- Account is a **Teacher** (teacher id in hidden `input[name=teacher]`; student ids in `.dropdown__list-item[data-value]` of the first dropdown).
- List endpoint: `GET /?load=Y&seart=Y&st=<comma-separated student ids>&t=<teacher id>` returns a JSON array of **all** lessons (Mar–Dec 2026, ignores date range): `{ id: string, start: "YYYY-MM-DDTHH:mm:ss", end, barColor, backColor, html }`. `html` begins with the subject text (e.g. `Computer Science`) followed by `<br>` and a `[HH:mm - HH:mm]` div. No student name in the list.
- Detail endpoint: `POST /` with form body `full=Y&id=<id>&tiher=Y&block=Y` returns `{ str: "<html>" }` containing the subject (`.pop_title`), date, the student's name, the lesson time "(Moscow Time Zone)" and the student's local time "(Tbilisi Time Zone)".
- **List times are Moscow time** (`Europe/Moscow`), confirmed against the detail view. Detail labels timezones by name, not IANA.
- Lesson durations seen: 45, 60, 90, 120 minutes.
- Login form: `form.login__form` with `login` and `pwd` fields; its presence on the page means logged out.
- Unknown yet: what `backColor`/`barColor` mean (status such as cancelled/free slot/rescheduled), and whether free slots appear in the list. Task 4 resolves this with the user before mapping.

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
- Timezone: list times are `Europe/Moscow` regardless of the browser's zone; every event carries an explicit `timeZone` (tested in Tasks 2 and 4). A user whose Chrome is in Lausanne must still get the right wall-clock time on the iPhone.
- 280 lessons in the list: detail requests only for lessons inside the sync window, cached by id in `chrome.storage.local`, so a sync does not fire hundreds of POSTs (Task 4).
- Detail request fails for one lesson (HTTP error or unparseable): that lesson still syncs with the subject only; the sync as a whole does not abort.
- Student names are children's names: they go only into the user's own Google calendar, never into logs, `syncState` or error messages.
- Unknown timezone label in the detail HTML: fall back to the list timezone, don't throw.
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
  - `interface Lesson { id: string; title: string; start: string; end?: string; timeZone: string; location?: string; description?: string }` (`start`/`end` are ISO 8601 local date-times without offset; `location` carries the meeting URL when present)
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

### Task 4: Portal parsers (list feed + lesson detail)

**Files:**
- Create: `tests/fixtures/list-sample.json`, `tests/fixtures/detail-sample.json` (hand-written with fake names and ids, same shape as the real responses described in "Portal facts"; no real data committed), `src/reader/parseList.ts`, `src/reader/parseDetail.ts`, `tests/parseList.test.ts`, `tests/parseDetail.test.ts`

**Interfaces:**
- Consumes: `Lesson` (Task 2).
- Produces:
  - `const PORTAL_TIME_ZONE = 'Europe/Moscow'`
  - `interface RawLesson { id: string; start: string; end: string; subject: string; backColor: string; barColor: string }`
  - `parseList(json: string): RawLesson[]` — `subject` is the `html` text before the first `<br>`, tags stripped and trimmed; dedupes by `id`; throws `ParseError` (exported class) if the JSON is not an array of objects with `id`/`start`/`end`; `[]` only for a literal empty array.
  - `interface LessonDetail { student?: string; meetingUrl?: string; studentTimeZoneLabel?: string }`
  - `parseDetail(json: string): LessonDetail` — reads `{ str }`, extracts the student name from the `ctudentns` block and a meeting URL from `a.btn_video_link` href if present; never throws on missing fields (returns `{}`), throws `ParseError` only on non-JSON input.
  - `toLesson(raw: RawLesson, detail?: LessonDetail): Lesson` — `title` is `"<subject> — <student>"` or just `subject` without detail; `timeZone` is `PORTAL_TIME_ZONE`.

- [ ] **Step 1: Ask the user what the calendar colors mean** (open the portal, compare a cancelled/rescheduled/free-slot lesson against a normal one). Record the answer in the spec and add a `status` field to `RawLesson` and a filter in `parseList` if some colors must be skipped (e.g. free slots, cancelled).
- [ ] **Step 2: Write failing tests:** `parseList` returns exact `RawLesson` values for the fixture; subject extracted as `Computer Science`; duplicate ids collapse; `parseList('{}')` and `parseList('nope')` throw `ParseError`; `parseList('[]')` returns `[]`. `parseDetail` returns the fake student name; a detail with no student block returns `{}`; `toLesson` sets `timeZone: 'Europe/Moscow'` and the combined title.
- [ ] **Step 3: Run** `npx vitest run tests/parseList.test.ts tests/parseDetail.test.ts` — Expected: FAIL.
- [ ] **Step 4: Implement** the three functions. Use `DOMParser`-free string handling for `html` subject extraction; for detail HTML use `DOMParser` (Vitest `jsdom` environment for that test file only).
- [ ] **Step 5: Run** — Expected: PASS. **Step 6: Commit** `feat: parse portal list and detail responses`.

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
- Create: `src/content.ts`, `src/reader/collect.ts`, `src/background.ts`, `src/messages.ts`, `tests/collect.test.ts`, `tests/background.test.ts`

**Interfaces:**
- Produces (`src/messages.ts`): `type Msg = { type: 'schedule'; source: string } | { type: 'syncNow' }`; `type SyncState = { status: 'ok' | 'error' | 'loggedOut' | 'idle'; at?: string; added?: number; updated?: number; removed?: number; error?: string }`, stored in `chrome.storage.local` under key `syncState`.
- Behavior: the content script (same-origin, so the session cookie is sent) runs `collectLessons(fetchImpl, doc)` from `src/reader/collect.ts`: if `form.login__form` exists, report `loggedOut`; otherwise read the teacher id from `input[name=teacher]` and student ids from the first `.dropdown__list` items' `data-value` (skipping empty), `GET` the list endpoint, `parseList`, keep lessons whose start is inside the sync window (`now − 7d … now + 60d`), then `POST` the detail endpoint for each of those whose id is not cached (cache in `chrome.storage.local` key `detailCache`, invalidated when `start`/`end` change), with concurrency 4. It sends `{type:'schedule', lessons}` to the worker. `background.ts` handles `schedule` (→ `runSync` → write `syncState`) and `syncNow` (ask the active portal tab to re-collect); `ParseError` and `GoogleApiError` become `status: 'error'` with a generic message (no student names) and write nothing. Token via `chrome.identity.getAuthToken`.
- Produces (`src/reader/collect.ts`): `collectLessons(deps: { fetchImpl: typeof fetch; doc: Document; cache: Map<string, LessonDetail & { start: string; end: string }>; now: Date }): Promise<{ status: 'ok'; lessons: Lesson[] } | { status: 'loggedOut' }>`. `Msg` becomes `{ type: 'schedule'; lessons: Lesson[] } | { type: 'syncNow' }`.

- [ ] **Step 1: Write failing tests:** (a) `collectLessons` with a fake `fetchImpl` and a jsdom document: logged-out page returns `loggedOut` and makes no fetch; lessons outside the window get no detail request; a cached id gets none; a failing detail request for one id still returns that lesson with subject-only title; list request URL contains the teacher and student ids read from the document. (b) `handleMessage(msg, deps)` exported from `background.ts` with injected deps: success writes counts; `ParseError` writes error state and calls no client method; an empty `lessons` array writes `ok` with zero removals.
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
