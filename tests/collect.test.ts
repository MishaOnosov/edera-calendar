// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { collectLessons, shouldCollect, type CachedDetail } from '../src/reader/collect';
import { ParseError } from '../src/reader/parseList';

const detailJson = readFileSync('tests/fixtures/detail-sample.json', 'utf8');
const now = new Date('2026-11-01T00:00:00Z');

const calendarPage = `
  <input type="hidden" name="teacher" class="teacher" value="77">
  <div class="calendar__dropdown dropdown"><ul class="dropdown__list">
    <li data-value="" class="dropdown__list-item">Select Student</li>
    <li data-value="11">A</li><li data-value="12">B</li>
  </ul></div>
  <div class="calendar__dropdown dropdown"><ul class="dropdown__list">
    <li data-value="">Select Service</li><li data-value="266">Mathematics</li>
  </ul></div>`;

const feed = [
  { id: '1', start: '2026-11-07T12:00:00', end: '2026-11-07T13:00:00', html: 'Math<br>', backColor: '', barColor: '' },
  { id: '2', start: '2026-11-14T12:00:00', end: '2026-11-14T13:00:00', html: 'Math<br>', backColor: '', barColor: '' },
  { id: '3', start: '2027-06-01T12:00:00', end: '2027-06-01T13:00:00', html: 'Math<br>', backColor: '', barColor: '' },
];

function makeFetch(failDetailFor?: string) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const id = new URLSearchParams(String(init.body)).get('id');
      if (id === failDetailFor) return new Response('err', { status: 500 });
      return new Response(detailJson);
    }
    expect(String(url)).toContain('/?load=Y');
    return new Response(JSON.stringify(feed));
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const docFrom = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

describe('collectLessons', () => {
  it('reports loggedOut without any request when the login form is present', async () => {
    const fetchImpl = makeFetch();
    const r = await collectLessons({ fetchImpl, doc: docFrom('<form class="login__form"></form>'), cache: new Map(), now });
    expect(r).toEqual({ status: 'loggedOut' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('builds the list URL from the teacher and student ids on the page', async () => {
    const fetchImpl = makeFetch();
    await collectLessons({ fetchImpl, doc: docFrom(calendarPage), cache: new Map(), now });
    const listUrl = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(listUrl).toBe('/?load=Y&seart=Y&st=11%2C12&t=77');
  });

  it('returns the whole feed but fetches details only for in-window lessons', async () => {
    const fetchImpl = makeFetch();
    const r = await collectLessons({ fetchImpl, doc: docFrom(calendarPage), cache: new Map(), now });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.lessons.map((l) => l.id)).toEqual(['1', '2', '3']);
    expect(r.lessons[0]?.title).toBe('Math — Test Student');
    expect(r.lessons[2]?.title).toBe('Math');
    const posts = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[1]?.method === 'POST');
    expect(posts).toHaveLength(2);
  });

  it('skips the detail request for cached lessons with unchanged times', async () => {
    const fetchImpl = makeFetch();
    const cache = new Map<string, CachedDetail>([
      ['1', { detail: { student: 'Cached Kid' }, start: '2026-11-07T12:00:00', end: '2026-11-07T13:00:00' }],
    ]);
    const r = await collectLessons({ fetchImpl, doc: docFrom(calendarPage), cache, now });
    const posts = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[1]?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(r.status === 'ok' && r.lessons[0]?.title).toBe('Math — Cached Kid');
  });

  it('still syncs a lesson whose detail request fails, with the subject only', async () => {
    const r = await collectLessons({ fetchImpl: makeFetch('2'), doc: docFrom(calendarPage), cache: new Map(), now });
    expect(r.status === 'ok' && r.lessons[1]?.title).toBe('Math');
  });

  it('throws a ParseError when the page has no teacher or students', async () => {
    await expect(collectLessons({ fetchImpl: makeFetch(), doc: docFrom('<p>hi</p>'), cache: new Map(), now })).rejects.toThrow(
      ParseError,
    );
  });
});

describe('shouldCollect', () => {
  it('is true on the calendar page and on the login page', () => {
    expect(shouldCollect(docFrom('<div id="dp"></div>'))).toBe(true);
    expect(shouldCollect(docFrom('<form class="login__form"></form>'))).toBe(true);
  });

  it('is false on other portal pages so a good sync state is not overwritten', () => {
    expect(shouldCollect(docFrom('<h1>FAQ</h1>'))).toBe(false);
  });
});
