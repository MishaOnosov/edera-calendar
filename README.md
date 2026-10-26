# Edera Calendar Sync

A Chrome extension that reads your schedule from the Edera School teacher portal (`lk.ederaschool.com`) and syncs it to a dedicated **Edera** Google calendar. Add that Google account to your iPhone and the lessons show up in the iOS Calendar app.

- Uses your **already logged-in** portal session. Your portal password is never stored, sent anywhere or committed.
- Writes only to the calendar named `Edera`; your other calendars are never touched.
- Lesson times are read as Moscow time (what the portal uses) and created with an explicit time zone.
- Don't add your own events to the `Edera` calendar: events there that are not in the portal are removed on sync.
- Window synced: 7 days back to 60 days ahead. An empty portal response never deletes events.

## Install (development)

```
npm ci
npm run build
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, choose the `dist/` folder.
2. Copy the extension **ID** shown on the card.

## Google OAuth client (one-time)

Works in any Chromium browser (Chrome, Arc, Brave, Edge). It uses a **Web application** client, not the "Chrome Extension" type.

1. In [Google Cloud Console](https://console.cloud.google.com/) create a project and enable the **Google Calendar API**.
2. Configure the OAuth consent screen (External, add yourself as a test user).
3. Credentials → Create credentials → **OAuth client ID** → Application type **Web application**.
   Under **Authorized redirect URIs** add `https://<extension-id>.chromiumapp.org/` (the extension ID is on `chrome://extensions`; keep the trailing slash).
4. Put the client ID in `src/config.ts` (`OAUTH_CLIENT_ID`), rebuild (`npm run build`) and reload the extension.

> Loaded-unpacked extensions get a new ID if the folder path changes, which breaks the redirect URI. Keep the folder where it is, or add a `key` to the manifest (Chrome docs: "Manifest key") to pin the ID.

## Use

Open `https://lk.ederaschool.com/` while logged in. The extension syncs automatically on page load; the toolbar popup shows the last result and has a **Sync now** button. First sync asks you to approve Google access.

## On the iPhone

Settings → Calendar → Accounts → Add Account → Google. Make sure Calendar is on; the **Edera** calendar appears in the Calendar app.

## Development

```
npm run lint && npm run typecheck && npm run test:coverage && npm run build
```

CI (GitHub Actions) runs all of the above on every push and pull request, uploads the built extension as an artifact, and runs a SonarCloud scan when the `SONAR_TOKEN` secret is set.

### SonarCloud

Project is imported with **GitHub Actions** analysis. Add the `SONAR_TOKEN` repository secret (Settings → Secrets and variables → Actions) and check `sonar.organization` / `sonar.projectKey` in `sonar-project.properties`. Coverage comes from `coverage/lcov.info`.

## Privacy

Test fixtures use made-up names. Never commit real portal responses: they contain students' names.
