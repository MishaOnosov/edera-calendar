import { DAY_MS, inWindow, localMs, syncWindow } from '../time';
import type { Lesson } from '../types';
import { parseDetail, toLesson, type LessonDetail } from './parseDetail';
import { ParseError, parseList, type RawLesson } from './parseList';

export interface CachedDetail {
  detail: LessonDetail;
  start: string;
  end: string;
}

export interface CollectDeps {
  fetchImpl: typeof fetch;
  doc: Document;
  cache: Map<string, CachedDetail>;
  now: Date;
}

export type CollectResult = { status: 'ok'; lessons: Lesson[] } | { status: 'loggedOut' };

const CONCURRENCY = 4;
/** The portal only shows the meeting link shortly before a lesson starts. */
const LINK_APPEARS_WITHIN_DAYS = 7;

/** The content script matches every portal page; only the calendar and login pages are relevant. */
export function shouldCollect(doc: Document): boolean {
  return Boolean(doc.querySelector('#dp, form.login__form'));
}

function pageIds(doc: Document): { teacher: string; students: string[] } {
  const teacher = doc.querySelector<HTMLInputElement>('input[name="teacher"]')?.value ?? '';
  const students = Array.from(doc.querySelectorAll('.calendar__dropdown .dropdown__list')[0]?.children ?? [])
    .map((li) => li.getAttribute('data-value') ?? '')
    .filter(Boolean);
  if (!teacher || students.length === 0) throw new ParseError('Calendar page has no teacher or student ids');
  return { teacher, students };
}

/** A cached detail without a meeting link goes stale once the lesson is close enough for the link to appear. */
function linkMayBeMissing(cached: CachedDetail, now: Date): boolean {
  if (cached.detail.meetingUrl) return false;
  return localMs(cached.start) <= now.getTime() + LINK_APPEARS_WITHIN_DAYS * DAY_MS;
}

async function fetchDetail(raw: RawLesson, deps: CollectDeps): Promise<LessonDetail | undefined> {
  const { fetchImpl } = deps; // call detached: browsers throw "Illegal invocation" if fetch is a method of another object
  const cached = deps.cache.get(raw.id);
  if (cached && cached.start === raw.start && cached.end === raw.end && !linkMayBeMissing(cached, deps.now)) {
    return cached.detail;
  }
  try {
    const res = await fetchImpl('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ full: 'Y', id: raw.id, tiher: 'Y', block: 'Y' }).toString(),
      credentials: 'same-origin',
    });
    if (!res.ok) return undefined;
    const detail = parseDetail(await res.text());
    deps.cache.set(raw.id, { detail, start: raw.start, end: raw.end });
    return detail;
  } catch {
    return undefined; // one bad lesson must not abort the whole sync
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Returns the WHOLE feed (runSync's empty-list safety needs it) but only fetches
 * per-lesson details for lessons inside the sync window.
 */
export async function collectLessons(deps: CollectDeps): Promise<CollectResult> {
  if (deps.doc.querySelector('form.login__form')) return { status: 'loggedOut' };

  const { fetchImpl } = deps; // call detached (see fetchDetail)
  const { teacher, students } = pageIds(deps.doc);
  const params = new URLSearchParams({ load: 'Y', seart: 'Y', st: students.join(','), t: teacher });
  const res = await fetchImpl(`/?${params}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Schedule request failed (${res.status})`);
  const raws = parseList(await res.text());

  const window = syncWindow(deps.now);
  const lessons = await pool(raws, CONCURRENCY, async (raw) =>
    toLesson(raw, inWindow(raw.start, window) ? await fetchDetail(raw, deps) : undefined),
  );
  return { status: 'ok', lessons };
}
