import { createTokenProvider, type StoredToken, type TokenStore } from './auth';
import { OAUTH_CLIENT_ID, OAUTH_SCOPE } from './config';
import { handleMessage, type BackgroundDeps } from './handler';
import { SYNC_STATE_KEY, type Msg, type TabMsg } from './messages';
import { GoogleCalendarClient } from './sync/google';

// Chrome wiring only: all logic lives in handler.ts / auth.ts and is unit-tested.
const TOKEN_KEY = 'googleToken';
// storage.session keeps the short-lived token out of disk; it survives service-worker restarts.
const area = chrome.storage.session ?? chrome.storage.local;
const tokenStore: TokenStore = {
  get: async () => (await area.get(TOKEN_KEY))[TOKEN_KEY] as StoredToken | undefined,
  set: async (t) => {
    if (t) await area.set({ [TOKEN_KEY]: t });
    else await area.remove(TOKEN_KEY);
  },
};
const getToken = createTokenProvider({
  api: chrome.identity,
  store: tokenStore,
  clientId: OAUTH_CLIENT_ID,
  scope: OAUTH_SCOPE,
  now: () => Date.now(),
});

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

chrome.runtime.onMessage.addListener((msg: Msg) => {
  void handleMessage(msg, chromeDeps());
});
