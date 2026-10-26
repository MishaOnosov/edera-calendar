import { SYNC_STATE_KEY, type Msg, type SyncState, type TabMsg } from './messages';
import { ParseError } from './reader/parseList';
import { GoogleApiError, GoogleCalendarClient } from './sync/google';
import { runSync, type SyncClient } from './sync/sync';

export interface BackgroundDeps {
  getClient: () => SyncClient;
  saveState: (s: SyncState) => Promise<void>;
  requestResync: () => Promise<void>;
  now: () => Date;
}

function describeError(e: unknown): string {
  if (e instanceof ParseError) return 'The portal page looked different than expected; nothing was synced.';
  if (e instanceof GoogleApiError) return `Google Calendar error (${e.status}); nothing was lost, try again.`;
  return 'Sync failed; try again.';
}

export async function handleMessage(msg: Msg, deps: BackgroundDeps): Promise<void> {
  if (msg.type === 'syncNow') return deps.requestResync();
  if (msg.type === 'loggedOut') return deps.saveState({ status: 'loggedOut', at: deps.now().toISOString() });
  try {
    const result = await runSync(msg.lessons, deps.getClient(), deps.now());
    await deps.saveState({ status: 'ok', at: deps.now().toISOString(), ...result });
  } catch (e) {
    await deps.saveState({ status: 'error', at: deps.now().toISOString(), error: describeError(e) });
  }
}

// --- Chrome wiring (thin; exercised manually) ---

async function getToken(refresh?: boolean): Promise<string> {
  let { token } = await chrome.identity.getAuthToken({ interactive: true });
  if (token && refresh) {
    // The cached token was rejected: drop it (survives service-worker restarts) and fetch a new one.
    await chrome.identity.removeCachedAuthToken({ token });
    ({ token } = await chrome.identity.getAuthToken({ interactive: true }));
  }
  if (!token) throw new Error('No Google token');
  return token;
}

function chromeDeps(): BackgroundDeps {
  return {
    getClient: () => new GoogleCalendarClient(getToken),
    saveState: (s) => chrome.storage.local.set({ [SYNC_STATE_KEY]: s }),
    requestResync: async () => {
      const tabs = await chrome.tabs.query({ url: 'https://lk.ederaschool.com/*' });
      const msg: TabMsg = { type: 'resync' };
      for (const tab of tabs) if (tab.id !== undefined) await chrome.tabs.sendMessage(tab.id, msg);
    },
    now: () => new Date(),
  };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg: Msg) => {
    void handleMessage(msg, chromeDeps());
  });
}
