import { createTokenProvider, type IdentityApi } from './auth';
import { handleMessage, type BackgroundDeps } from './handler';
import { SYNC_STATE_KEY, type Msg, type TabMsg } from './messages';
import { GoogleCalendarClient } from './sync/google';

// Chrome wiring only: all logic lives in handler.ts / auth.ts and is unit-tested.
const getToken = createTokenProvider(chrome.identity as unknown as IdentityApi);

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
