import { describe, expect, it } from 'vitest';
import { renderState } from '../src/popup/render';

const fmt = (iso: string) => `T(${iso})`;

describe('renderState', () => {
  it('shows counts after a successful sync', () => {
    expect(renderState({ status: 'ok', at: 'X', added: 2, updated: 1, removed: 0 }, fmt)).toBe(
      'Last sync T(X): 2 added, 1 updated, 0 removed',
    );
  });

  it('tells the user to log in when logged out', () => {
    expect(renderState({ status: 'loggedOut' }, fmt)).toBe('Log in to lk.ederaschool.com, then press Sync now.');
  });

  it('shows the error message', () => {
    expect(renderState({ status: 'error', error: 'Boom' }, fmt)).toBe('Sync failed: Boom');
  });

  it('handles idle and a missing state', () => {
    expect(renderState({ status: 'idle' }, fmt)).toBe('Not synced yet. Open lk.ederaschool.com or press Sync now.');
    expect(renderState(undefined, fmt)).toBe('Not synced yet. Open lk.ederaschool.com or press Sync now.');
  });
});
