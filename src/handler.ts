import { AuthError } from './auth';
import type { Msg, SyncState } from './messages';
import { ParseError } from './reader/parseList';
import { GoogleApiError } from './sync/google';
import { runSync, type SyncClient } from './sync/sync';

export interface BackgroundDeps {
  getClient: () => SyncClient;
  saveState: (s: SyncState) => Promise<void>;
  requestResync: () => Promise<void>;
  now: () => Date;
}

function describeError(e: unknown): string {
  if (e instanceof ParseError) return 'The portal page looked different than expected; nothing was synced.';
  if (e instanceof AuthError) return 'Google sign-in failed or was cancelled; press Sync now to try again.';
  if (e instanceof GoogleApiError) return `Google Calendar error (${e.reason ? `${e.status}: ${e.reason}` : e.status}); nothing was lost, try again.`;
  return 'Sync failed; try again.';
}

let syncing = false;

export async function handleMessage(msg: Msg, deps: BackgroundDeps): Promise<void> {
  if (msg.type === 'syncNow') return deps.requestResync();
  if (msg.type === 'loggedOut') return deps.saveState({ status: 'loggedOut', at: deps.now().toISOString() });
  if (syncing) return; // every portal page load sends a schedule; never run two syncs at once
  syncing = true;
  try {
    const result = await runSync(msg.lessons, deps.getClient(), deps.now());
    await deps.saveState({ status: 'ok', at: deps.now().toISOString(), ...result });
  } catch (e) {
    await deps.saveState({ status: 'error', at: deps.now().toISOString(), error: describeError(e) });
  } finally {
    syncing = false;
  }
}
