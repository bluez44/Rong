import type { SharePlatform } from '@rong/shared-types';

export const MAX_URL_LENGTH = 2048;
export const MAX_SHARED_TEXT = 5000;

/** Tham số chỉ để theo dõi lượt chia sẻ: bỏ để URL gọn và gộp được trùng. */
const TRACKING_PARAMS =
  /^(utm_.+|igsh|igshid|si|fbclid|gclid|mibextid|_t|_r|is_from_webapp|sender_device)$/i;

const PLATFORM_HOSTS: Array<[SharePlatform, string[]]> = [
  ['tiktok', ['tiktok.com']],
  ['youtube', ['youtube.com', 'youtu.be']],
  ['facebook', ['facebook.com', 'fb.watch', 'fb.com']],
  ['instagram', ['instagram.com']],
];

/** URL http(s) đầu tiên trong văn bản; bỏ dấu câu dính ở cuối. */
export function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  return match[0].replace(/[),.;!?…]+$/u, '');
}

/** Chỉ nhận http/https, cổng mặc định, không có user:pass; bỏ tham số theo dõi. */
export function normalizeShareUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.port !== '' && url.port !== '80' && url.port !== '443') return null;
  if (url.username || url.password) return null;
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  return url;
}

export function detectPlatform(url: URL): SharePlatform {
  const host = url.hostname.toLowerCase();
  for (const [platform, hosts] of PLATFORM_HOSTS) {
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`)))
      return platform;
  }
  return 'web';
}

/**
 * Chuẩn hóa thứ app gửi lên: URL riêng, hoặc URL nằm trong caption. Văn bản
 * luôn được giữ (kể cả khi có URL) vì caption thường là chỗ duy nhất nêu tên
 * địa điểm. Không còn gì dùng được thì null.
 */
export function normalizeShareInput(input: {
  url?: string;
  text?: string;
}): { url: URL | null; text: string | null } | null {
  const text = input.text?.trim().slice(0, MAX_SHARED_TEXT) || null;
  const rawUrl = input.url?.trim() || (text ? extractUrl(text) : null);
  const url = rawUrl ? normalizeShareUrl(rawUrl) : null;
  if (!url && !text) return null;
  return { url, text };
}
