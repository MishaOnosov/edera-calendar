import type { Lesson } from '../types';
import { diffEvents } from './diff';
import type { GoogleCalendarClient } from './google';
import { lessonToEvent } from './mapping';

export type SyncClient = Pick<GoogleCalendarClient, 'ensureCalendar' | 'listEvents' | 'insert' | 'patch' | 'remove'>;

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
}

export const CALENDAR_NAME = 'Edera';
const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_DAYS = 7;
const FUTURE_DAYS = 60;

export async function runSync(lessons: Lesson[], client: SyncClient, now: Date): Promise<SyncResult> {
  const min = new Date(now.getTime() - PAST_DAYS * DAY_MS);
  const max = new Date(now.getTime() + FUTURE_DAYS * DAY_MS);
  const inWindow = lessons.filter((l) => {
    const t = new Date(`${l.start}Z`).getTime(); // wall-clock approximation is fine at day granularity
    return t >= min.getTime() && t <= max.getTime();
  });

  const calendarId = await client.ensureCalendar(CALENDAR_NAME);
  const existing = await client.listEvents(calendarId, min.toISOString(), max.toISOString());
  const diff = diffEvents(inWindow.map(lessonToEvent), existing);

  // An empty list is indistinguishable from a portal glitch: never wipe the calendar on it.
  const toRemove = lessons.length === 0 ? [] : diff.remove;

  for (const e of diff.create) await client.insert(calendarId, e);
  for (const e of diff.update) await client.patch(calendarId, e);
  for (const id of toRemove) await client.remove(calendarId, id);
  return { added: diff.create.length, updated: diff.update.length, removed: toRemove.length };
}
