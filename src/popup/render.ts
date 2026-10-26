import type { SyncState } from '../messages';

const defaultFormat = (iso: string) => new Date(iso).toLocaleString();

export function renderState(state: SyncState | undefined, format: (iso: string) => string = defaultFormat): string {
  switch (state?.status) {
    case 'ok':
      return `Last sync ${format(state.at ?? '')}: ${state.added ?? 0} added, ${state.updated ?? 0} updated, ${state.removed ?? 0} removed`;
    case 'loggedOut':
      return 'Log in to lk.ederaschool.com, then press Sync now.';
    case 'error':
      return `Sync failed: ${state.error ?? 'unknown error'}`;
    default:
      return 'Not synced yet. Open lk.ederaschool.com or press Sync now.';
  }
}
