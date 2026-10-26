import { describe, expect, it, vi } from 'vitest';
import { handleMessage, type BackgroundDeps } from '../src/handler';
import { ParseError } from '../src/reader/parseList';
import { AuthError } from '../src/auth';
import { GoogleApiError } from '../src/sync/google';
import type { SyncState } from '../src/messages';
import type { Lesson } from '../src/types';

const lesson: Lesson = { id: '1', title: 'Math', start: '2026-11-07T12:00:00', end: '2026-11-07T13:00:00', timeZone: 'Europe/Moscow' };

function deps(over: Partial<BackgroundDeps> = {}) {
  const states: SyncState[] = [];
  const client = {
    ensureCalendar: vi.fn(async () => 'cal'),
    listEvents: vi.fn(async () => []),
    insert: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  const d: BackgroundDeps = {
    getClient: () => client,
    saveState: async (s) => void states.push(s),
    requestResync: vi.fn(async () => undefined),
    now: () => new Date('2026-11-01T00:00:00Z'),
    ...over,
  };
  return { d, states, client };
}

describe('handleMessage', () => {
  it('syncs a schedule and records the counts', async () => {
    const { d, states, client } = deps();
    await handleMessage({ type: 'schedule', lessons: [lesson] }, d);
    expect(client.insert).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({ status: 'ok', added: 1, updated: 0, removed: 0 });
  });

  it('records ok with zero removals for an empty schedule', async () => {
    const { d, states, client } = deps();
    await handleMessage({ type: 'schedule', lessons: [] }, d);
    expect(client.remove).not.toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({ status: 'ok', removed: 0 });
  });

  it('records loggedOut and touches nothing', async () => {
    const { d, states, client } = deps();
    await handleMessage({ type: 'loggedOut' }, d);
    expect(states.at(-1)?.status).toBe('loggedOut');
    expect(client.ensureCalendar).not.toHaveBeenCalled();
  });

  it('turns a ParseError into an error state without calling Google', async () => {
    const { d, states, client } = deps({ getClient: () => { throw new ParseError('bad'); } });
    await handleMessage({ type: 'schedule', lessons: [lesson] }, d);
    expect(states.at(-1)).toMatchObject({ status: 'error' });
    expect(client.insert).not.toHaveBeenCalled();
  });

  it('turns Google errors into a generic message that never echoes lesson data', async () => {
    const { d, states } = deps({ getClient: () => { throw new GoogleApiError(500, 'Google Calendar request failed (500)'); } });
    await handleMessage({ type: 'schedule', lessons: [{ ...lesson, title: 'Math — Secret Kid' }] }, d);
    expect(states.at(-1)?.error).toContain('500');
    expect(JSON.stringify(states)).not.toContain('Secret Kid');
  });

  it('asks the portal tab to resync on syncNow', async () => {
    const { d } = deps();
    await handleMessage({ type: 'syncNow' }, d);
    expect(d.requestResync).toHaveBeenCalled();
  });

  it('explains a failed Google sign-in', async () => {
    const { d, states } = deps({ getClient: () => { throw new AuthError(); } });
    await handleMessage({ type: 'schedule', lessons: [lesson] }, d);
    expect(states.at(-1)?.error).toContain('sign-in');
  });

  it('shows the Google error reason code in the popup message', async () => {
    const { d, states } = deps({ getClient: () => { throw new GoogleApiError(403, 'x', 'accessNotConfigured'); } });
    await handleMessage({ type: 'schedule', lessons: [lesson] }, d);
    expect(states.at(-1)?.error).toContain('403: accessNotConfigured');
  });

  it('ignores a schedule that arrives while a sync is already running', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { d, states, client } = deps();
    client.ensureCalendar.mockImplementation(async () => {
      await gate;
      return 'cal';
    });
    const first = handleMessage({ type: 'schedule', lessons: [lesson] }, d);
    await handleMessage({ type: 'schedule', lessons: [lesson] }, d);
    release();
    await first;
    expect(client.ensureCalendar).toHaveBeenCalledTimes(1);
    expect(states.filter((s) => s.status === 'ok')).toHaveLength(1);
  });
});
