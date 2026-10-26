import type { GCalEvent } from '../types';

export interface EventDiff {
  create: GCalEvent[];
  update: GCalEvent[];
  remove: string[];
}

function sameContent(a: GCalEvent, b: GCalEvent): boolean {
  return (
    a.summary === b.summary &&
    a.start.dateTime === b.start.dateTime &&
    a.start.timeZone === b.start.timeZone &&
    a.end.dateTime === b.end.dateTime &&
    a.end.timeZone === b.end.timeZone &&
    (a.location ?? '') === (b.location ?? '') &&
    (a.description ?? '') === (b.description ?? '')
  );
}

export function diffEvents(desired: GCalEvent[], existing: GCalEvent[]): EventDiff {
  const wanted = new Map<string, GCalEvent>();
  for (const e of desired) if (!wanted.has(e.id)) wanted.set(e.id, e);
  const current = new Map(existing.map((e) => [e.id, e]));

  const diff: EventDiff = { create: [], update: [], remove: [] };
  for (const [id, event] of wanted) {
    const have = current.get(id);
    if (!have) diff.create.push(event);
    else if (!sameContent(event, have)) diff.update.push(event);
  }
  for (const id of current.keys()) if (!wanted.has(id)) diff.remove.push(id);
  return diff;
}
