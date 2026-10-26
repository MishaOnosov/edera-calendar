import { describe, expect, it } from 'vitest';
import { DAY_MS, inWindow, localMs, syncWindow } from '../src/time';

const now = new Date('2026-11-01T00:00:00Z');

describe('time helpers', () => {
  it('reads a local date-time as if it were UTC', () => {
    expect(localMs('2026-11-01T12:00:00')).toBe(Date.parse('2026-11-01T12:00:00Z'));
  });

  it('builds a window from 7 days back to 60 days ahead', () => {
    const w = syncWindow(now);
    expect(w.min.toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(w.max.getTime() - now.getTime()).toBe(60 * DAY_MS);
  });

  it('includes both window edges and excludes outside lessons', () => {
    const w = syncWindow(now);
    expect(inWindow('2026-10-25T00:00:00', w)).toBe(true);
    expect(inWindow('2026-12-31T00:00:00', w)).toBe(true);
    expect(inWindow('2026-10-24T23:59:59', w)).toBe(false);
    expect(inWindow('2026-12-31T00:00:01', w)).toBe(false);
  });
});
