import { SYNC_STATE_KEY, type Msg, type SyncState } from '../messages';
import { renderState } from './render';

const status = document.getElementById('status');
const button = document.getElementById('sync');

function show(state: SyncState | undefined): void {
  if (status) status.textContent = renderState(state);
}

void chrome.storage.local.get(SYNC_STATE_KEY).then((r) => show(r[SYNC_STATE_KEY] as SyncState | undefined));
chrome.storage.onChanged.addListener((changes) => {
  const change = changes[SYNC_STATE_KEY];
  if (change) show(change.newValue as SyncState | undefined);
});

button?.addEventListener('click', () => {
  const msg: Msg = { type: 'syncNow' };
  void chrome.runtime.sendMessage(msg);
  if (status) status.textContent = 'Syncing…';
});
