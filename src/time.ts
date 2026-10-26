export const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_DAYS = 7;
const FUTURE_DAYS = 60;

/**
 * Epoch milliseconds of a local date-time string read as if it were UTC. Only valid for comparing
 * or shifting portal wall-clock times against each other (day granularity), never for real instants.
 */
export const localMs = (dateTime: string): number => new Date(`${dateTime}Z`).getTime();

export interface SyncWindow {
  min: Date;
  max: Date;
}

/** The slice of time kept in sync: 7 days back to 60 days ahead. */
export function syncWindow(now: Date): SyncWindow {
  return {
    min: new Date(now.getTime() - PAST_DAYS * DAY_MS),
    max: new Date(now.getTime() + FUTURE_DAYS * DAY_MS),
  };
}

export function inWindow(start: string, window: SyncWindow): boolean {
  const t = localMs(start);
  return t >= window.min.getTime() && t <= window.max.getTime();
}
