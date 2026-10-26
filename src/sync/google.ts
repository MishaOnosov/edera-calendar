import type { GCalEvent } from '../types';

const API = 'https://www.googleapis.com/calendar/v3';

export class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Google's machine-readable reason (e.g. `accessNotConfigured`); never free-form text. */
    public readonly reason?: string,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

/** `refresh` asks the caller to drop its cached token and fetch a new one. */
export type TokenProvider = (refresh?: boolean) => Promise<string>;

interface GoogleEventResource {
  id: string;
  summary?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  location?: string;
  description?: string;
}

/** Google returns an offset (`+03:00`/`Z`); we compare local wall-clock times in the event's own zone. */
const stripOffset = (dateTime: string) => dateTime.replace(/(Z|[+-]\d{2}:\d{2})$/, '');

function toEvent(r: GoogleEventResource): GCalEvent | undefined {
  if (!r.start?.dateTime || !r.end?.dateTime) return undefined; // all-day events are not ours
  const e: GCalEvent = {
    id: r.id,
    summary: r.summary ?? '',
    start: { dateTime: stripOffset(r.start.dateTime), timeZone: r.start.timeZone ?? 'UTC' },
    end: { dateTime: stripOffset(r.end.dateTime), timeZone: r.end.timeZone ?? 'UTC' },
  };
  if (r.location) e.location = r.location;
  if (r.description) e.description = r.description;
  return e;
}

async function errorReason(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { errors?: { reason?: unknown }[] } };
    const reason = body.error?.errors?.[0]?.reason;
    return typeof reason === 'string' && /^[A-Za-z]{1,40}$/.test(reason) ? reason : undefined;
  } catch {
    return undefined;
  }
}

export class GoogleCalendarClient {
  constructor(
    private readonly getToken: TokenProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(path: string, init: RequestInit = {}, okStatuses: number[] = []): Promise<Response> {
    const fetchImpl = this.fetchImpl; // call detached: browsers throw "Illegal invocation" if fetch is a method of another object
    const send = async (token: string) =>
      fetchImpl(`${API}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
    let res = await send(await this.getToken());
    if (res.status === 401) res = await send(await this.getToken(true));
    if (!res.ok && !okStatuses.includes(res.status)) {
      throw new GoogleApiError(res.status, `Google Calendar request failed (${res.status})`, await errorReason(res));
    }
    return res;
  }

  async ensureCalendar(name: string): Promise<string> {
    let pageToken: string | undefined;
    do {
      const query = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '';
      const page = (await (await this.request(`/users/me/calendarList${query}`)).json()) as {
        items?: { id: string; summary?: string }[];
        nextPageToken?: string;
      };
      const found = page.items?.find((c) => c.summary === name);
      if (found) return found.id;
      pageToken = page.nextPageToken;
    } while (pageToken);

    const created = (await (
      await this.request('/calendars', { method: 'POST', body: JSON.stringify({ summary: name }) })
    ).json()) as { id: string };
    return created.id;
  }

  async listEvents(calendarId: string, timeMin: string, timeMax: string): Promise<GCalEvent[]> {
    const events: GCalEvent[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', maxResults: '2500' });
      if (pageToken) params.set('pageToken', pageToken);
      const page = (await (
        await this.request(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`)
      ).json()) as { items?: GoogleEventResource[]; nextPageToken?: string };
      for (const item of page.items ?? []) {
        const e = toEvent(item);
        if (e) events.push(e);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return events;
  }

  async insert(calendarId: string, e: GCalEvent): Promise<void> {
    const res = await this.request(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      { method: 'POST', body: JSON.stringify(e) },
      [409],
    );
    if (res.status === 409) await this.patch(calendarId, e); // id already exists (e.g. re-created)
  }

  async patch(calendarId: string, e: GCalEvent): Promise<void> {
    await this.request(`/calendars/${encodeURIComponent(calendarId)}/events/${e.id}`, {
      method: 'PATCH',
      // Google keeps deleted ids as 'cancelled'; confirming revives a restored lesson.
      body: JSON.stringify({ ...e, status: 'confirmed' }),
    });
  }

  async remove(calendarId: string, eventId: string): Promise<void> {
    await this.request(`/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, { method: 'DELETE' }, [404, 410]);
  }
}
