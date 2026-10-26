import { inWindow, syncWindow } from '../time';
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

export async function runSync(lessons: Lesson[], client: SyncClient, now: Date): Promise<SyncResult> {
  const window = syncWindow(now);
  const wanted = lessons.filter((l) => inWindow(l.start, window));

  const calendarId = await client.ensureCalendar(CALENDAR_NAME);
  const existing = await client.listEvents(calendarId, window.min.toISOString(), window.max.toISOString());
  const diff = diffEvents(wanted.map(lessonToEvent), existing);

  // An empty list is indistinguishable from a portal glitch: never wipe the calendar on it.
  const toRemove = lessons.length === 0 ? [] : diff.remove;

  for (const e of diff.create) await client.insert(calendarId, e);
  for (const e of diff.update) await client.patch(calendarId, e);
  for (const id of toRemove) await client.remove(calendarId, id);
  return { added: diff.create.length, updated: diff.update.length, removed: toRemove.length };
}
