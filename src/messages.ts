import type { Lesson } from './types';

export type Msg = { type: 'schedule'; lessons: Lesson[] } | { type: 'loggedOut' } | { type: 'syncNow' };

/** Sent from the background to portal tabs. */
export type TabMsg = { type: 'resync' };

export interface SyncState {
  status: 'idle' | 'ok' | 'error' | 'loggedOut';
  at?: string;
  added?: number;
  updated?: number;
  removed?: number;
  /** Always generic: never contains lesson titles or student names. */
  error?: string;
}

export const SYNC_STATE_KEY = 'syncState';
export const DETAIL_CACHE_KEY = 'detailCache';
