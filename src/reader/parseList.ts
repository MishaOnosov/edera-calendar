export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export interface RawLesson {
  id: string;
  start: string;
  end: string;
  subject: string;
  backColor: string;
  barColor: string;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/** The portal puts the subject first, followed by `<br>` and a time div. */
function subjectFromHtml(html: string): string {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const beforeBreak = withoutComments.split(/<br\s*\/?>/i)[0] ?? '';
  return beforeBreak
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .trim();
}

const isString = (v: unknown): v is string => typeof v === 'string';

export function parseList(json: string): RawLesson[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ParseError('Schedule response is not valid JSON');
  }
  if (!Array.isArray(data)) throw new ParseError('Schedule response is not a list');

  const seen = new Set<string>();
  const lessons: RawLesson[] = [];
  for (const item of data as Record<string, unknown>[]) {
    const { id, start, end } = item ?? {};
    if (!isString(id) || !isString(start) || !isString(end)) {
      throw new ParseError('Schedule entry is missing id, start or end');
    }
    if (seen.has(id)) continue;
    seen.add(id);
    lessons.push({
      id,
      start,
      end,
      subject: subjectFromHtml(isString(item.html) ? item.html : ''),
      backColor: isString(item.backColor) ? item.backColor : '',
      barColor: isString(item.barColor) ? item.barColor : '',
    });
  }
  return lessons;
}
