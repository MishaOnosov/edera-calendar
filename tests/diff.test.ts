import { describe, expect, it } from 'vitest';
import { diffEvents } from '../src/sync/diff';
import type { GCalEvent } from '../src/types';

const ev = (id: string, start = '2026-11-07T12:00:00', summary = 'Math'): GCalEvent => ({
  id,
  summary,
  start: { dateTime: start, timeZone: 'Europe/Moscow' },
  end: { dateTime: '2026-11-07T13:00:00', timeZone: 'Europe/Moscow' },
});

describe('diffEvents', () => {
  it('creates events that do not exist yet', () => {
    expect(diffEvents([ev('a')], [])).toEqual({ create: [ev('a')], update: [], remove: [] });
  });

  it('does nothing for identical events', () => {
    expect(diffEvents([ev('a')], [ev('a')])).toEqual({ create: [], update: [], remove: [] });
  });

  it('updates a rescheduled lesson in place', () => {
    const moved = ev('a', '2026-11-08T12:00:00');
    expect(diffEvents([moved], [ev('a')])).toEqual({ create: [], update: [moved], remove: [] });
  });

  it('updates when summary, location or description change', () => {
    expect(diffEvents([ev('a', undefined, 'New')], [ev('a')]).update).toHaveLength(1);
    expect(diffEvents([{ ...ev('a'), location: 'x' }], [ev('a')]).update).toHaveLength(1);
    expect(diffEvents([{ ...ev('a'), description: 'x' }], [ev('a')]).update).toHaveLength(1);
  });

  it('removes events no longer desired', () => {
    expect(diffEvents([], [ev('a')])).toEqual({ create: [], update: [], remove: ['a'] });
  });

  it('collapses duplicate desired ids to the first', () => {
    const r = diffEvents([ev('a'), ev('a', '2026-11-09T12:00:00')], []);
    expect(r.create).toEqual([ev('a')]);
  });
});
