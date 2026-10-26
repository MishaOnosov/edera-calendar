import { localMs } from '../time';
import type { GCalEvent, Lesson } from '../types';

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/**
 * Google event ids must be base32hex (a-v, 0-9), 5-1024 chars. Encoding the lesson id
 * (instead of hashing it) is deterministic and cannot collide; the prefix guarantees length >= 5.
 */
export function eventId(lessonId: string): string {
  const bytes = new TextEncoder().encode(lessonId);
  let bits = 0;
  let value = 0;
  let out = 'edera';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32HEX[(value << (5 - bits)) & 31];
  return out;
}

/** Adds ms to a local date-time string without applying any time zone or DST. */
function addToLocal(dateTime: string, ms: number): string {
  return new Date(localMs(dateTime) + ms).toISOString().slice(0, 19);
}

export function lessonToEvent(l: Lesson): GCalEvent {
  const end = l.end ?? addToLocal(l.start, DEFAULT_DURATION_MS);
  const event: GCalEvent = {
    id: eventId(l.id),
    summary: l.title,
    start: { dateTime: l.start, timeZone: l.timeZone },
    end: { dateTime: end, timeZone: l.timeZone },
  };
  if (l.location) event.location = l.location;
  if (l.description) event.description = l.description;
  return event;
}
