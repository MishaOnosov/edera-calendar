import type { Lesson } from '../types';
import { ParseError, type RawLesson } from './parseList';

/** The portal's list times are Moscow time, regardless of the browser's zone. */
export const PORTAL_TIME_ZONE = 'Europe/Moscow';

export interface LessonDetail {
  student?: string;
  meetingUrl?: string;
}

export function parseDetail(json: string): LessonDetail {
  let str: unknown;
  try {
    str = (JSON.parse(json) as { str?: unknown }).str;
  } catch {
    throw new ParseError('Lesson detail response is not valid JSON');
  }
  if (typeof str !== 'string') return {};

  const doc = new DOMParser().parseFromString(str, 'text/html');
  const detail: LessonDetail = {};
  const student = doc.querySelector('.ctudentns')?.textContent?.trim();
  if (student) detail.student = student;
  const meetingUrl = doc.querySelector('a.btn_video_link')?.getAttribute('href');
  if (meetingUrl) detail.meetingUrl = meetingUrl;
  return detail;
}

export function toLesson(raw: RawLesson, detail: LessonDetail = {}): Lesson {
  const lesson: Lesson = {
    id: raw.id,
    title: detail.student ? `${raw.subject} — ${detail.student}` : raw.subject,
    start: raw.start,
    end: raw.end,
    timeZone: PORTAL_TIME_ZONE,
  };
  if (detail.meetingUrl) lesson.location = detail.meetingUrl;
  return lesson;
}
