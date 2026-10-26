import { DETAIL_CACHE_KEY, SYNC_STATE_KEY, type Msg, type SyncState, type TabMsg } from './messages';
import { collectLessons, shouldCollect, type CachedDetail } from './reader/collect';

async function loadCache(): Promise<Map<string, CachedDetail>> {
  const stored = (await chrome.storage.local.get(DETAIL_CACHE_KEY))[DETAIL_CACHE_KEY] as Record<string, CachedDetail> | undefined;
  return new Map(Object.entries(stored ?? {}));
}

async function collectAndSend(): Promise<void> {
  const cache = await loadCache();
  const result = await collectLessons({ fetchImpl: fetch, doc: document, cache, now: new Date() });
  await chrome.storage.local.set({ [DETAIL_CACHE_KEY]: Object.fromEntries(cache) });
  const msg: Msg = result.status === 'loggedOut' ? { type: 'loggedOut' } : { type: 'schedule', lessons: result.lessons };
  await chrome.runtime.sendMessage(msg);
}

function run(): void {
  if (!shouldCollect(document)) return;
  collectAndSend().catch(() => {
    // The page changed shape or the network failed: report generically; never include page data.
    const state: SyncState = { status: 'error', at: new Date().toISOString(), error: 'Could not read the portal page.' };
    void chrome.storage.local.set({ [SYNC_STATE_KEY]: state });
  });
}

run();
chrome.runtime.onMessage.addListener((msg: TabMsg) => {
  if (msg.type === 'resync') run();
});
