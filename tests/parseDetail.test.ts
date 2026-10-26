// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ParseError } from '../src/reader/parseList';
import { PORTAL_TIME_ZONE, parseDetail, toLesson } from '../src/reader/parseDetail';

const detail = readFileSync('tests/fixtures/detail-sample.json', 'utf8');
const withLink = readFileSync('tests/fixtures/detail-with-link.json', 'utf8');
const raw = {
  id: '1001',
  start: '2026-11-07T12:00:00',
  end: '2026-11-07T13:30:00',
  subject: 'Computer Science',
  backColor: '#94608d',
  barColor: '#a5de00',
};

describe('parseDetail', () => {
  it('reads the student name and ignores commented-out meeting info', () => {
    expect(parseDetail(detail)).toEqual({ student: 'Test Student' });
  });

  it('reads the meeting URL from a.btn_video_link', () => {
    expect(parseDetail(withLink)).toEqual({ student: 'Test Student', meetingUrl: 'https://example.com/meet/abc' });
  });

  it('returns {} when fields are missing and throws only on non-JSON', () => {
    expect(parseDetail('{"str":"<div></div>"}')).toEqual({});
    expect(() => parseDetail('<html>')).toThrow(ParseError);
  });
});

describe('toLesson', () => {
  it('combines subject and student and uses the portal time zone', () => {
    expect(toLesson(raw, { student: 'Test Student', meetingUrl: 'https://example.com/m' })).toEqual({
      id: '1001',
      title: 'Computer Science — Test Student',
      start: '2026-11-07T12:00:00',
      end: '2026-11-07T13:30:00',
      timeZone: PORTAL_TIME_ZONE,
      location: 'https://example.com/m',
    });
  });

  it('falls back to the subject alone without detail', () => {
    const l = toLesson(raw);
    expect(l.title).toBe('Computer Science');
    expect(l.timeZone).toBe('Europe/Moscow');
    expect(l.location).toBeUndefined();
  });
});
