import { describe, expect, it } from 'vitest';
import { eventId, lessonToEvent } from '../src/sync/mapping';
import type { Lesson } from '../src/types';

const lesson: Lesson = {
  id: '76391',
  title: 'Computer Science — Test Student',
  start: '2026-11-07T12:00:00',
  end: '2026-11-07T13:30:00',
  timeZone: 'Europe/Moscow',
  location: 'https://example.com/meet',
};

describe('eventId', () => {
  it('is stable and valid for Google (base32hex, 5-1024 chars)', () => {
    expect(eventId('76391')).toBe(eventId('76391'));
    expect(eventId('76391')).toMatch(/^[a-v0-9]{5,1024}$/);
  });

  it('differs for different lessons, including short ids', () => {
    expect(eventId('x')).not.toBe(eventId('y'));
    expect(eventId('1')).toMatch(/^[a-v0-9]{5,}$/);
  });
});

describe('lessonToEvent', () => {
  it('maps title, times and explicit time zone', () => {
    const e = lessonToEvent(lesson);
    expect(e.id).toBe(eventId('76391'));
    expect(e.summary).toBe('Computer Science — Test Student');
    expect(e.start).toEqual({ dateTime: '2026-11-07T12:00:00', timeZone: 'Europe/Moscow' });
    expect(e.end).toEqual({ dateTime: '2026-11-07T13:30:00', timeZone: 'Europe/Moscow' });
    expect(e.location).toBe('https://example.com/meet');
  });

  it('defaults a missing end to start + 1 hour', () => {
    const e = lessonToEvent({ ...lesson, end: undefined });
    expect(e.end).toEqual({ dateTime: '2026-11-07T13:00:00', timeZone: 'Europe/Moscow' });
  });

  it('rolls the default end over midnight', () => {
    const e = lessonToEvent({ ...lesson, start: '2026-12-31T23:30:00', end: undefined });
    expect(e.end.dateTime).toBe('2027-01-01T00:30:00');
  });
});
