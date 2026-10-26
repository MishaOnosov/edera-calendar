# Edera Calendar Sync — Design

## Goal
A Chrome extension that reads the user's schedule from https://lk.ederaschool.com/ (the first page shows the calendar) and syncs it to a dedicated Google calendar ("Edera"). The user adds their Google account to iOS once, so lessons appear in iPhone Calendar automatically. Success: new, moved and cancelled lessons are reflected on the iPhone without manual copying.

## Decisions made with the user
- Delivery: Google Calendar API (not .ics feed, not manual export).
- Browser: Chrome, Manifest V3, loaded unpacked (also works in Edge/Brave/Arc).
- Portal credentials are never stored or handled by the extension or the repo; it reuses the user's logged-in browser session. (The password was posted in chat once; the user should rotate it.)

## Portal findings (verified 2026-10-26 by logging in)
- Server-rendered 1C-Bitrix site; the calendar is a DayPilot widget filled from a same-origin JSON list endpoint (all lessons, Mar–Dec 2026) plus a per-lesson detail endpoint (student name, meeting info). The account is a Teacher with multiple students. No page sample is needed from the user; the reader calls these endpoints from the content script with the user's session.
- Feed times are Moscow time (`Europe/Moscow`).
- Open question: meaning of the calendar colors (cancelled / rescheduled / free slot). To resolve with the user before the parser maps statuses.
- Details are in the implementation plan, "Portal facts".

## Assumptions
- The user must create a Google Cloud OAuth client (type: Chrome Extension, Calendar API enabled). Setup steps will be documented in the README.

## Architecture
1. **Reader** (content script on `lk.ederaschool.com`): extracts lessons from the logged-in page into a normalized `Lesson { id, title, start, end, location/link, teacher?, notes? }`.
2. **Sync worker** (MV3 service worker): maps lessons to Google events with a deterministic event ID derived from the lesson id, then diffs against the "Edera" calendar: create new, patch changed, delete removed within the synced window. Touches only the "Edera" calendar, created on first run.
3. **Auth**: `chrome.identity` OAuth, scope `calendar` limited to what is needed (calendar creation + events on that calendar).
4. **Triggers**: popup "Sync now" button; auto-sync when the portal page is opened; optional periodic alarm.
5. **Popup UI**: last sync time, counts (added/updated/removed), clear error state.

## Error handling
- Logged out of the portal: popup says so; nothing is written.
- Parse failure / unexpected page format: fail with a clear message; never write partial data or delete events on a failed or empty parse.
- Google auth/API errors: surfaced in popup; retry on next trigger.

## Testing
- Unit tests (Vitest) for parser (against saved sample fixture), lesson→event mapping, and diffing, with the Google API mocked.
- Manual end-to-end check in Chrome against the real portal and a test Google account.

## CI (GitHub Actions)
Runs on push and pull request:
1. `npm ci`
2. Lint + type-check
3. Unit tests
4. Validate `manifest.json` and build the extension
5. Upload the built extension zip as an artifact

No secrets needed in CI (Google calls mocked, fixtures committed). The OAuth client ID is not a secret but is kept in config, not hardcoded in logic. Portal credentials never enter the repo or CI. Assumes GitHub; the user did not specify otherwise.

## Out of scope
Two-way sync, other calendars, Safari, a hosted backend.
