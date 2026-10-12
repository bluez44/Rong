import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';

import { Logger } from '@nestjs/common';
import type { SharePlatform } from '@rong/shared-types';
import { Agent, fetch as undiciFetch } from 'undici';

import { detectPlatform } from './share-url.js';

export interface LinkMetadata {
  platform: SharePlatform;
  finalUrl: string;
  title: string | null;
  description: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
}

export interface LinkMetadataDeps {
  fetch: typeof fetch;
  lookup: (hostname: string) => Promise<string[]>;
  metaOembedToken: string | null;
  contactEmail: string;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 1_000_000;

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 96], // gồm ::, ::1 và IPv4-compatible (::a.b.c.d)
  ['::ffff:0:0:0', 96], // SIIT
  ['64:ff9b:1::', 48], // NAT64 cục bộ
  ['2002::', 16], // 6to4
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10], // site-local (đã bỏ)
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

/** Lấy IPv4 nhúng trong IPv6 (::ffff:a.b.c.d, ::ffff:hhhh:hhhh, 64:ff9b::/96) để kiểm tra như IPv4. */
function embeddedIpv4(ip: string): string | null {
  const dotted = ip.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return dotted[1];
  const hex = ip.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** IP có định tuyến công khai không (chặn loopback, mạng nội bộ, link-local, CGNAT…). */
export function isPublicAddress(ip: string): boolean {
  const embedded = embeddedIpv4(ip);
  if (embedded) return isPublicAddress(embedded);
  const family = isIP(ip);
  if (family === 4) return !PRIVATE.check(ip, 'ipv4');
  if (family === 6) return !PRIVATE.check(ip, 'ipv6');
  return false;
}

/** Thẻ Open Graph, rơi về <title> / meta description. Regex đủ cho <head>, không cần DOM. */
export function parseOpenGraph(html: string): {
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  authorName: string | null;
} {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = attr(tag, 'property') ?? attr(tag, 'name');
    const content = attr(tag, 'content');
    if (key && content && !meta.has(key.toLowerCase())) meta.set(key.toLowerCase(), content);
  }
  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = meta.get(key);
      if (value?.trim()) return decodeEntities(value.trim());
    }
    return null;
  };
  return {
    title: pick('og:title', 'twitter:title') ?? (titleTag?.trim() ? decodeEntities(titleTag.trim()) : null),
    description: pick('og:description', 'twitter:description', 'description'),
    thumbnailUrl: pick('og:image', 'twitter:image'),
    authorName: pick('author', 'article:author'),
  };
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? (match[1] ?? match[2] ?? null) : null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Cổng duy nhất đọc link người dùng chia sẻ (F4, FR-4.2). Chỉ metadata công
 * khai: oEmbed khi nền tảng có, còn lại Open Graph. Mọi host (kể cả sau mỗi
 * redirect) phải phân giải ra IP công khai trước khi được gọi.
 *
 * Chống DNS rebinding: assertSafe chỉ là kiểm tra sớm. Ở production,
 * createLinkMetadataService gắn vào undici một `lookup` đã ghim
 * (createPinnedLookup): chính lần phân giải mà kết nối TCP dùng được kiểm tra
 * và từ chối nếu có địa chỉ không công khai, nên không có lần phân giải thứ
 * hai để kẻ tấn công đổi đáp án.
 */
export class LinkMetadataService {
  private readonly logger = new Logger(LinkMetadataService.name);

  constructor(private readonly deps: LinkMetadataDeps) {}

  async assertSafe(url: URL): Promise<void> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new UnsafeUrlError(`Giao thức ${url.protocol} không được phép`);
    }
    // URL chuẩn hóa cổng mặc định thành chuỗi rỗng.
    if (url.port !== '' && url.port !== '80' && url.port !== '443') {
      throw new UnsafeUrlError(`Cổng ${url.port} không được phép`);
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [host] : await this.deps.lookup(host).catch(() => []);
    if (addresses.length === 0 || addresses.some((ip) => !isPublicAddress(ip))) {
      throw new UnsafeUrlError(`Host ${host} không phải địa chỉ công khai`);
    }
  }

  async fetch(url: URL): Promise<LinkMetadata | null> {
    try {
      const resolved = await this.resolveRedirects(url);
      if (!resolved) return null;
      const platform = detectPlatform(resolved.url);
      const oembed = await this.oembed(platform, resolved.url);
      if (oembed) return oembed;
      if (!resolved.html) return null;
      const og = parseOpenGraph(resolved.html);
      if (!og.title && !og.description) return null;
      return { platform, finalUrl: resolved.url.toString(), ...og };
    } catch (error) {
      if (error instanceof UnsafeUrlError) throw error;
      this.logger.warn(`Không đọc được metadata ${url.hostname}: ${(error as Error).message}`);
      return null;
    }
  }

  /** Theo redirect tới trang cuối; trả HTML nếu trang cuối là HTML. */
  private async resolveRedirects(start: URL): Promise<{ url: URL; html: string | null } | null> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Kiểm tra từng chặng trước khi gọi: redirect tới địa chỉ nội bộ dừng tại đây.
      await this.assertSafe(url);
      const response = await this.deps.fetch(url.toString(), {
        redirect: 'manual',
        headers: this.headers('text/html'),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        const location = response.headers.get('location');
        if (!location) return null;
        url = new URL(location, url);
        continue;
      }
      // oEmbed vẫn chạy được dù trang chặn (403 với bot), nên vẫn trả URL.
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { url, html: null };
      }
      const type = response.headers.get('content-type') ?? '';
      if (!type.includes('html')) {
        await response.body?.cancel().catch(() => undefined);
        return type.includes('json') ? { url, html: null } : null;
      }
      return { url, html: await readLimited(response) };
    }
    return null;
  }

  private async oembed(platform: SharePlatform, page: URL): Promise<LinkMetadata | null> {
    const endpoint = this.oembedEndpoint(platform, page);
    if (!endpoint) return null;
    try {
      // Endpoint cố định của nền tảng; không theo redirect để không rời khỏi host đã biết.
      const response = await this.deps.fetch(endpoint, {
        redirect: 'manual',
        headers: this.headers('application/json'),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
      };
      if (!body.title && !body.author_name) return null;
      return {
        platform,
        finalUrl: page.toString(),
        title: body.title?.trim() || null,
        description: null,
        authorName: body.author_name?.trim() || null,
        thumbnailUrl: body.thumbnail_url || null,
      };
    } catch {
      return null;
    }
  }

  private oembedEndpoint(platform: SharePlatform, page: URL): string | null {
    const target = encodeURIComponent(page.toString());
    switch (platform) {
      case 'tiktok':
        return `https://www.tiktok.com/oembed?url=${target}`;
      case 'youtube':
        return `https://www.youtube.com/oembed?format=json&url=${target}`;
      case 'facebook':
      case 'instagram': {
        const token = this.deps.metaOembedToken;
        if (!token) return null;
        const kind = platform === 'facebook' ? 'oembed_post' : 'instagram_oembed';
        return `https://graph.facebook.com/v21.0/${kind}?url=${target}&omitscript=true&access_token=${encodeURIComponent(token)}`;
      }
      default:
        return null;
    }
  }

  private headers(accept: string): Record<string, string> {
    return {
      'User-Agent': `Mozilla/5.0 (compatible; RongBot/1.0; +mailto:${this.deps.contactEmail})`,
      Accept: accept,
      'Accept-Language': 'vi,en;q=0.8',
    };
  }
}

/** Đọc tối đa MAX_BYTES; trang lớn hơn chỉ lấy phần đầu (đủ cho <head>). */
async function readLimited(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let bytes = 0;
  try {
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.byteLength > MAX_BYTES - bytes ? value.subarray(0, MAX_BYTES - bytes) : value;
      bytes += chunk.byteLength;
      html += decoder.decode(chunk, { stream: true });
    }
    html += decoder.decode();
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return html;
}

/**
 * `lookup` cho kết nối TCP: phân giải một lần, từ chối nếu có địa chỉ không
 * công khai, còn lại kết nối thẳng tới địa chỉ vừa kiểm tra.
 */
export function createPinnedLookup(resolve: (hostname: string) => Promise<string[]>): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some((ip) => !isPublicAddress(ip))) {
          callback(new UnsafeUrlError(`Host ${hostname} không phải địa chỉ công khai`), '', 4);
          return;
        }
        const entries = addresses.map((address) => ({ address, family: isIP(address) }));
        if (options?.all) callback(null, entries);
        else callback(null, entries[0].address, entries[0].family);
      },
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), '', 4),
    );
  };
}

export function createLinkMetadataService(config: {
  metaOembedToken: string | null;
  contactEmail: string;
}): LinkMetadataService {
  const lookup = async (host: string) =>
    (await dnsLookup(host, { all: true })).map((a) => a.address);
  const dispatcher = new Agent({ connect: { lookup: createPinnedLookup(lookup) } });
  return new LinkMetadataService({
    fetch: ((input: unknown, init?: unknown) =>
      undiciFetch(input as string, { ...(init as object), dispatcher })) as unknown as typeof fetch,
    lookup,
    ...config,
  });
}
