import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ParseError, parseList } from '../src/reader/parseList';

const sample = readFileSync('tests/fixtures/list-sample.json', 'utf8');

describe('parseList', () => {
  it('extracts exact raw lessons and the subject before <br>', () => {
    const lessons = parseList(sample);
    expect(lessons[0]).toEqual({
      id: '1001',
      start: '2026-11-07T12:00:00',
      end: '2026-11-07T13:30:00',
      subject: 'Computer Science',
      backColor: '#94608d',
      barColor: '#a5de00',
    });
  });

  it('strips tags from the subject', () => {
    expect(parseList(sample)[1]?.subject).toBe('Mathematics');
  });

  it('dedupes by id', () => {
    expect(parseList(sample).map((l) => l.id)).toEqual(['1001', '1002']);
  });

  it('returns [] only for a literal empty array', () => {
    expect(parseList('[]')).toEqual([]);
  });

  it('throws ParseError for non-arrays, bad JSON and entries missing fields', () => {
    expect(() => parseList('{}')).toThrow(ParseError);
    expect(() => parseList('nope')).toThrow(ParseError);
    expect(() => parseList('[{"id":"1"}]')).toThrow(ParseError);
  });
});
