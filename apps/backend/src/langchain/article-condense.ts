import { normalizeForMatch } from '../modules/places/web-grounding.js';

/**
 * Giới hạn khi rút gọn một bài (spec 2026-10-21-ward-search §4). Cắt cứng 2.500 ký tự đầu làm bài
 * "Top 20" chỉ còn 2–3 mục; giữ mọi tiêu đề mục để Gemini thấy đủ tên, mỗi mục chỉ kèm đoạn đầu.
 */
export const CONDENSE_LIMITS = {
  intro: 600,
  heading: 150,
  section: 400,
  minSection: 120,
  article: 12_000,
  unstructured: 6_000,
  /** Dưới chừng này tiêu đề thì coi là bài viết liền. */
  minHeadings: 3,
} as const;

const JUNK_PHRASES = [
  'xem them',
  'chia se',
  'dang ky nhan',
  'ban quyen',
  'cookie',
  'theo doi chung toi',
];
const JUNK_SECTIONS = [
  'bai viet lien quan',
  'co the ban quan tam',
  'binh luan',
  'tin moi nhat',
  'tin lien quan',
  'bai viet moi',
];
const LINK = /\[([^\]]*)\]\([^)]*\)/g;

interface Section {
  heading: string | null;
  lines: string[];
}

/** Tiêu đề mục: markdown `#`, in đậm có số `**1. Tên**`, danh sách có số ngắn `1. Tên` / `1) Tên`. */
function headingText(line: string): string | null {
  const md = /^#{1,6}\s+(.+)$/.exec(line);
  const raw = md ? md[1] : line;
  const unbold = raw.replace(/^\*\*(.+?)\*\*:?$/, '$1').trim();
  if (md) return unbold;
  if (/^\*\*\s*\d+[.)]\s*.+\*\*:?$/.test(line)) return unbold;
  if (/^\d+[.)]\s+\S/.test(line) && line.length < 120) return line;
  return null;
}

function isJunkLine(line: string): boolean {
  if (line.length < 3) return true;
  const linkChars = [...line.matchAll(LINK)].reduce(
    (n, m) => n + m[0].length,
    0,
  );
  if (linkChars / line.length > 0.6) return true;
  if (line.includes('©')) return true;
  const folded = normalizeForMatch(line);
  return JUNK_PHRASES.some(
    (p) => folded.startsWith(p) || folded.includes(` ${p} `) || folded === p,
  );
}

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const space = slice.lastIndexOf(' ');
  return `${(space > max * 0.6 ? slice.slice(0, space) : slice).trimEnd()}…`;
}

/**
 * Rút gọn markdown của một bài viết. Trả về văn bản (đưa vào prompt và dùng để kiểm chứng tên)
 * và số tiêu đề đã giữ.
 */
export function condenseArticle(markdown: string): {
  text: string;
  headings: number;
} {
  const seen = new Set<string>();
  const sections: Section[] = [{ heading: null, lines: [] }];
  let skipping = false;

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = headingText(line);
    if (heading !== null) {
      skipping = JUNK_SECTIONS.some((s) =>
        normalizeForMatch(heading).startsWith(s),
      );
      if (!skipping)
        sections.push({
          heading: heading.slice(0, CONDENSE_LIMITS.heading),
          lines: [],
        });
      continue;
    }
    if (skipping || isJunkLine(line)) continue;
    const key = normalizeForMatch(line);
    if (seen.has(key)) continue;
    seen.add(key);
    sections[sections.length - 1].lines.push(line.replace(LINK, '$1'));
  }

  const [intro, ...items] = sections;
  const headings = items.length;
  const introText = intro.lines.join('\n');

  if (headings < CONDENSE_LIMITS.minHeadings) {
    const all = [
      introText,
      ...items.flatMap((s) => [s.heading ?? '', ...s.lines]),
    ]
      .filter(Boolean)
      .join('\n');
    return { text: cutAtWord(all, CONDENSE_LIMITS.unstructured), headings };
  }

  const headingChars = items.reduce(
    (n, s) => n + (s.heading?.length ?? 0) + 1,
    0,
  );
  const introPart = cutAtWord(introText, CONDENSE_LIMITS.intro);
  const room = CONDENSE_LIMITS.article - headingChars - introPart.length;
  const perSection = Math.max(
    CONDENSE_LIMITS.minSection,
    Math.min(CONDENSE_LIMITS.section, Math.floor(room / headings) - 1),
  );

  const out: string[] = introPart ? [introPart] : [];
  let used = introPart.length;
  for (const s of items) {
    const head = s.heading ?? '';
    if (used + head.length + 1 > CONDENSE_LIMITS.article) break;
    out.push(head);
    used += head.length + 1;
    const body = cutAtWord(s.lines.join(' '), perSection);
    if (body && used + body.length + 1 <= CONDENSE_LIMITS.article) {
      out.push(body);
      used += body.length + 1;
    }
  }
  return { text: out.join('\n'), headings };
}
