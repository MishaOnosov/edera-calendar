import { describe, expect, it } from 'vitest';
import { runSync, type SyncClient } from '../src/sync/sync';
import { eventId, lessonToEvent } from '../src/sync/mapping';
import type { GCalEvent, Lesson } from '../src/types';

const now = new Date('2026-11-01T00:00:00Z');
const lesson = (id: string, start = '2026-11-07T12:00:00'): Lesson => ({
  id,
  title: 'Math',
  start,
  end: start.replace('12:00', '13:00'),
  timeZone: 'Europe/Moscow',
});

function fakeClient(existing: GCalEvent[]) {
  const log = { inserted: [] as string[], patched: [] as string[], removed: [] as string[], range: [] as string[] };
  const client: SyncClient = {
    ensureCalendar: async (name) => `cal:${name}`,
    listEvents: async (_cal, min, max) => {
      log.range = [min, max];
      return existing;
    },
    insert: async (_c, e) => void log.inserted.push(e.id),
    patch: async (_c, e) => void log.patched.push(e.id),
    remove: async (_c, id) => void log.removed.push(id),
  };
  return { client, log };
}

describe('runSync', () => {
  it('applies creates, updates and removals and reports counts', async () => {
    const stale = lessonToEvent(lesson('old'));
    const moved = { ...lessonToEvent(lesson('moved')), summary: 'Different' };
    const { client, log } = fakeClient([stale, moved]);
    const result = await runSync([lesson('new'), lesson('moved')], client, now);
    expect(result).toEqual({ added: 1, updated: 1, removed: 1 });
    expect(log.inserted).toEqual([eventId('new')]);
    expect(log.patched).toEqual([eventId('moved')]);
    expect(log.removed).toEqual([eventId('old')]);
  });

  it('never deletes anything when the lesson list is empty', async () => {
    const { client, log } = fakeClient([lessonToEvent(lesson('a'))]);
    const result = await runSync([], client, now);
    expect(result).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(log.removed).toEqual([]);
  });

  it('lists the window from 7 days ago to 60 days ahead and ignores lessons outside it', async () => {
    const { client, log } = fakeClient([]);
    const result = await runSync([lesson('far', '2027-06-01T12:00:00'), lesson('in')], client, now);
    expect(log.range).toEqual(['2026-10-25T00:00:00.000Z', '2026-12-31T00:00:00.000Z']);
    expect(result.added).toBe(1);
  });
});
