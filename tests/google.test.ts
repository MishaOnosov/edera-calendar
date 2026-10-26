import { describe, expect, it, vi } from 'vitest';
import { GoogleApiError, GoogleCalendarClient } from '../src/sync/google';
import type { GCalEvent } from '../src/types';

type Call = { url: string; method: string; body?: unknown; auth: string | null };

function fakeFetch(handler: (c: Call) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.get('Authorization'),
    };
    calls.push(call);
    const { status = 200, json } = handler(call);
    return new Response(json === undefined ? null : JSON.stringify(json), { status });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const event: GCalEvent = {
  id: 'edera1',
  summary: 'Math',
  start: { dateTime: '2026-11-07T12:00:00', timeZone: 'Europe/Moscow' },
  end: { dateTime: '2026-11-07T13:00:00', timeZone: 'Europe/Moscow' },
};
const getToken = vi.fn(async () => 'tok');

describe('ensureCalendar', () => {
  it('reuses an existing calendar by name, across pages', async () => {
    const { impl, calls } = fakeFetch((c) =>
      c.url.includes('pageToken=p2')
        ? { json: { items: [{ id: 'cal-edera', summary: 'Edera' }] } }
        : { json: { items: [{ id: 'x', summary: 'Other' }], nextPageToken: 'p2' } },
    );
    const id = await new GoogleCalendarClient(getToken, impl).ensureCalendar('Edera');
    expect(id).toBe('cal-edera');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls[0]?.auth).toBe('Bearer tok');
  });

  it('creates the calendar when absent', async () => {
    const { impl, calls } = fakeFetch((c) =>
      c.method === 'POST' ? { json: { id: 'new-cal' } } : { json: { items: [] } },
    );
    expect(await new GoogleCalendarClient(getToken, impl).ensureCalendar('Edera')).toBe('new-cal');
    expect(calls.at(-1)?.body).toEqual({ summary: 'Edera' });
  });
});

describe('listEvents', () => {
  it('paginates and strips UTC offsets so times compare as local wall-clock', async () => {
    const item = (id: string, token?: string) => ({
      items: [
        {
          id,
          summary: 'Math',
          start: { dateTime: '2026-11-07T12:00:00+03:00', timeZone: 'Europe/Moscow' },
          end: { dateTime: '2026-11-07T13:00:00+03:00', timeZone: 'Europe/Moscow' },
          location: 'https://example.com/m',
        },
        { id: 'allday', summary: 'Holiday', start: { date: '2026-11-07' }, end: { date: '2026-11-08' } },
      ],
      nextPageToken: token,
    });
    const { impl, calls } = fakeFetch((c) => ({ json: c.url.includes('pageToken=n') ? item('b') : item('a', 'n') }));
    const events = await new GoogleCalendarClient(getToken, impl).listEvents('cal', '2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z');
    expect(events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(events[0]?.start.dateTime).toBe('2026-11-07T12:00:00');
    expect(events[0]?.location).toBe('https://example.com/m');
    expect(calls[0]?.url).toContain('singleEvents=true');
  });
});

describe('writes', () => {
  it('insert posts, patch patches, remove deletes', async () => {
    const { impl, calls } = fakeFetch(() => ({ json: {} }));
    const c = new GoogleCalendarClient(getToken, impl);
    await c.insert('cal', event);
    await c.patch('cal', event);
    await c.remove('cal', 'edera1');
    expect(calls.map((x) => x.method)).toEqual(['POST', 'PATCH', 'DELETE']);
    expect(calls[1]?.url).toContain('/events/edera1');
  });

  it('insert falls back to patch on 409', async () => {
    const { impl, calls } = fakeFetch((c) => (c.method === 'POST' ? { status: 409 } : { json: {} }));
    await new GoogleCalendarClient(getToken, impl).insert('cal', event);
    expect(calls.map((x) => x.method)).toEqual(['POST', 'PATCH']);
  });

  it('remove treats 404/410 as already gone', async () => {
    const { impl } = fakeFetch(() => ({ status: 410 }));
    await expect(new GoogleCalendarClient(getToken, impl).remove('cal', 'x')).resolves.toBeUndefined();
  });
});

describe('errors', () => {
  it('retries once with a refreshed token on 401', async () => {
    let n = 0;
    const tokens = vi.fn(async (refresh?: boolean) => (refresh ? 'fresh' : 'old'));
    const { impl, calls } = fakeFetch(() => (n++ === 0 ? { status: 401 } : { json: { items: [] } }));
    await new GoogleCalendarClient(tokens, impl).listEvents('cal', 'a', 'b');
    expect(tokens).toHaveBeenLastCalledWith(true);
    expect(calls.map((c) => c.auth)).toEqual(['Bearer old', 'Bearer fresh']);
  });

  it('throws GoogleApiError on other failures without leaking the response body', async () => {
    const { impl } = fakeFetch(() => ({ status: 500, json: { error: 'boom' } }));
    const err = await new GoogleCalendarClient(getToken, impl).listEvents('cal', 'a', 'b').catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err.status).toBe(500);
  });
});

describe('patch', () => {
  it('marks the event confirmed so a restored lesson is revived', async () => {
    const { impl, calls } = fakeFetch(() => ({ json: {} }));
    await new GoogleCalendarClient(getToken, impl).patch('cal', event);
    expect(calls[0]?.body).toMatchObject({ id: 'edera1', status: 'confirmed' });
  });
});

describe('fetch invocation', () => {
  it('calls fetchImpl detached, as browsers throw "Illegal invocation" for fetch called as a method', async () => {
    const strictFetch = function (this: unknown) {
      if (this !== undefined) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(JSON.stringify({ items: [{ id: 'c', summary: 'Edera' }] })));
    } as unknown as typeof fetch;
    expect(await new GoogleCalendarClient(getToken, strictFetch).ensureCalendar('Edera')).toBe('c');
  });
});

describe('error reason', () => {
  it('exposes Google\'s machine-readable reason but not the message text', async () => {
    const { impl } = fakeFetch(() => ({
      status: 403,
      json: { error: { message: 'Calendar API has not been used in project 1', errors: [{ reason: 'accessNotConfigured' }] } },
    }));
    const err = await new GoogleCalendarClient(getToken, impl).listEvents('cal', 'a', 'b').catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err.status).toBe(403);
    expect(err.reason).toBe('accessNotConfigured');
    expect(err.message).not.toContain('project 1');
  });

  it('has no reason when the body is not JSON', async () => {
    const { impl } = fakeFetch(() => ({ status: 502 }));
    const err = await new GoogleCalendarClient(getToken, impl).listEvents('cal', 'a', 'b').catch((e) => e);
    expect(err.reason).toBeUndefined();
  });
});
