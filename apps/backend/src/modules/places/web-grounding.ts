import type { WebSource } from '../../langchain/web-search.tool.js';

/**
 * Chuẩn hóa để so tên với nội dung bài: bỏ dấu (kể cả đ), chữ thường, mọi
 * thứ không phải chữ/số thành một khoảng trắng.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Các bài viết (trong số bài model đã đọc) có nhắc tên địa điểm. Rỗng nghĩa
 * là tên không có trong nguồn nào — địa điểm do model tự thêm, phải bỏ.
 * Chấp nhận tên model viết kèm phần trong ngoặc hay kèm tên vùng ở cuối.
 */
export function articlesMentioning(
  title: string,
  regionName: string,
  sources: WebSource[],
): WebSource[] {
  const candidates = nameVariants(title, regionName);
  if (candidates.length === 0) return [];
  return sources.filter((source) => {
    const content = ` ${normalizeForMatch(`${source.title} ${source.content}`)} `;
    return candidates.some((name) => content.includes(` ${name} `));
  });
}

function nameVariants(title: string, regionName: string): string[] {
  const variants = new Set<string>();
  const base = normalizeForMatch(title);
  variants.add(base);
  variants.add(normalizeForMatch(title.replace(/\([^)]*\)/g, ' ')));
  for (const part of regionName.split(',')) {
    const suffix = normalizeForMatch(part);
    if (suffix && base.endsWith(` ${suffix}`)) {
      variants.add(base.slice(0, -suffix.length - 1).trim());
    }
  }
  // Tên quá ngắn ("cho", "ho") khớp bừa vào bài nào cũng được.
  return [...variants].filter((name) => name.length >= 4);
}

const PUBLISHED_META_KEYS = new Set([
  'article:published_time',
  'og:published_time',
  'datepublished',
  'pubdate',
  'publishdate',
  'publish-date',
  'publish_date',
  'dc.date',
  'dc.date.issued',
  'parsely-pub-date',
  'sailthru.date',
]);

/**
 * Ngày đăng bài trong HTML: thẻ meta phổ biến (Open Graph, Dublin Core…),
 * `itemprop="datePublished"`, rồi JSON-LD. Không đoán từ thẻ `<time>` bất kỳ
 * vì trang hay có ngày của bình luận, bài liên quan…
 */
export function extractPublishedDate(html: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = parseAttributes(tag);
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? '').toLowerCase();
    if (PUBLISHED_META_KEYS.has(key)) {
      const date = toIsoDate(attrs.content);
      if (date) return date;
    }
  }
  for (const tag of html.match(/<[a-z]+\b[^>]*itemprop=["']datePublished["'][^>]*>/gi) ?? []) {
    const attrs = parseAttributes(tag);
    const date = toIsoDate(attrs.datetime ?? attrs.content);
    if (date) return date;
  }
  for (const match of html.matchAll(/"datePublished"\s*:\s*"([^"]+)"/g)) {
    const date = toIsoDate(match[1]);
    if (date) return date;
  }
  return null;
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? '';
  }
  return attrs;
}

/** Ngày hợp lệ và hợp lý (không trước khi có web, không ở tương lai). */
function toIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value.trim());
  if (Number.isNaN(time)) return null;
  if (time < Date.UTC(1995, 0, 1) || time > Date.now() + 24 * 60 * 60 * 1000) {
    return null;
  }
  return new Date(time).toISOString();
}

const DATE_FETCH_TIMEOUT_MS = 4000;
/** Meta ngày đăng nằm trong <head>, không cần đọc cả trang. */
const MAX_HTML_CHARS = 300_000;

/** Tải trang và đọc ngày đăng. Lỗi, hết giờ hay không có ngày đều trả null. */
export async function fetchPublishedDate(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RongBot/1.0)',
        Accept: 'text/html',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(DATE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    if (!(response.headers.get('content-type') ?? '').includes('html')) {
      return null;
    }
    return extractPublishedDate((await response.text()).slice(0, MAX_HTML_CHARS));
  } catch {
    return null;
  }
}
