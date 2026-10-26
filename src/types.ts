export interface Lesson {
  id: string;
  title: string;
  /** ISO 8601 local date-time without offset, in `timeZone`. */
  start: string;
  end?: string;
  timeZone: string;
  /** Meeting URL when the portal provides one. */
  location?: string;
  description?: string;
}

export interface GCalEvent {
  id: string;
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: string;
  description?: string;
}
