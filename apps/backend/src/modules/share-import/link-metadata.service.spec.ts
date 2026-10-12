import { describe, expect, it, vi } from 'vitest';

import {
  isPublicAddress,
  LinkMetadataService,
  parseOpenGraph,
  UnsafeUrlError,
} from './link-metadata.service.js';

type Route = { status?: number; headers?: Record<string, string>; body?: string };

function service(
  routes: Record<string, Route>,
  dns: Record<string, string[]> = {},
  metaOembedToken: string | null = null,
) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL) => {
    const url = input.toString();
    calls.push(url);
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    return new Response(route.body ?? '', {
      status: route.status ?? 200,
      headers: route.headers ?? { 'content-type': 'text/html' },
    });
  });
  const lookup = vi.fn(async (host: string) => dns[host] ?? ['93.184.216.34']);
  return {
    calls,
    svc: new LinkMetadataService({
      fetch: fetchImpl as unknown as typeof fetch,
      lookup,
      metaOembedToken,
      contactEmail: 'dev@rong.local',
    }),
  };
}

describe('isPublicAddress', () => {
  it.each([
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.16.0.1', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['::1', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:7f00:1', false],
    ['::ffff:a9fe:a9fe', false],
    ['64:ff9b::7f00:1', false],
    ['93.184.216.34', true],
    ['::ffff:5db8:d822', true],
    ['2606:4700::1111', true],
  ])('%s → %s', (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

describe('parseOpenGraph', () => {
  it('đọc og:*, rơi về <title> và meta description, giải mã entity', () => {
    const html = `<html><head>
      <title>Không dùng</title>
      <meta property="og:title" content="Top 5 quán cà phê Đà Lạt &amp; view đồi">
      <meta name="description" content="Mô tả dự phòng">
      <meta property="og:image" content="https://cdn.vn/a.jpg">
    </head></html>`;
    expect(parseOpenGraph(html)).toEqual({
      title: 'Top 5 quán cà phê Đà Lạt & view đồi',
      description: 'Mô tả dự phòng',
      thumbnailUrl: 'https://cdn.vn/a.jpg',
      authorName: null,
    });
  });
});

describe('LinkMetadataService.fetch', () => {
  it('TikTok dùng oEmbed', async () => {
    const page = 'https://www.tiktok.com/@an/video/1';
    const { svc } = service({
      // Trang thật hay chặn bot (403); oEmbed vẫn chạy.
      [page]: { status: 403 },
      [`https://www.tiktok.com/oembed?url=${encodeURIComponent(page)}`]: {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Bánh căn Nhà Chung ngon nhất Đà Lạt',
          author_name: 'an.reviews',
          thumbnail_url: 'https://p16.tiktokcdn.com/t.jpg',
        }),
      },
    });
    await expect(svc.fetch(new URL(page))).resolves.toEqual({
      platform: 'tiktok',
      finalUrl: page,
      title: 'Bánh căn Nhà Chung ngon nhất Đà Lạt',
      description: null,
      authorName: 'an.reviews',
      thumbnailUrl: 'https://p16.tiktokcdn.com/t.jpg',
    });
  });

  it('link rút gọn: theo redirect rồi mới gọi oEmbed bằng URL cuối', async () => {
    const short = 'https://vt.tiktok.com/ZS1/';
    const page = 'https://www.tiktok.com/@an/video/2';
    const { svc } = service({
      [short]: { status: 301, headers: { location: page } },
      [page]: { body: '' },
      [`https://www.tiktok.com/oembed?url=${encodeURIComponent(page)}`]: {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Chợ đêm' }),
      },
    });
    const meta = await svc.fetch(new URL(short));
    expect(meta?.finalUrl).toBe(page);
    expect(meta?.title).toBe('Chợ đêm');
  });

  it('web thường dùng Open Graph', async () => {
    const page = 'https://vnexpress.net/da-lat';
    const { svc } = service({
      [page]: { body: '<meta property="og:title" content="Đà Lạt mùa hoa">' },
    });
    expect((await svc.fetch(new URL(page)))?.title).toBe('Đà Lạt mùa hoa');
  });

  it('Facebook không có token: đọc Open Graph; bị chặn thì null', async () => {
    const page = 'https://www.facebook.com/share/r/1';
    const { svc } = service({ [page]: { status: 403 } });
    await expect(svc.fetch(new URL(page))).resolves.toBeNull();
  });

  it('redirect sang IP nội bộ: dừng, không đọc trang đó', async () => {
    const short = 'https://bit.ly/x';
    const { svc, calls } = service(
      {
        [short]: { status: 302, headers: { location: 'http://metadata.internal/latest' } },
        'http://metadata.internal/latest': { body: 'SECRET' },
      },
      { 'metadata.internal': ['169.254.169.254'] },
    );
    await expect(svc.fetch(new URL(short))).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(calls).toEqual([short]);
  });

  it('redirect sang cổng lạ: dừng, không gọi cổng đó', async () => {
    const short = 'https://bit.ly/y';
    const { svc, calls } = service({
      [short]: { status: 302, headers: { location: 'http://a.vn:6379/' } },
    });
    await expect(svc.fetch(new URL(short))).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(calls).toEqual([short]);
  });

  it('quá 5 redirect thì null', async () => {
    const routes: Record<string, Route> = {};
    for (let i = 0; i < 7; i++) {
      routes[`https://a.vn/${i}`] = { status: 302, headers: { location: `https://a.vn/${i + 1}` } };
    }
    const { svc } = service(routes);
    await expect(svc.fetch(new URL('https://a.vn/0'))).resolves.toBeNull();
  });

  it('không phải HTML/JSON thì null', async () => {
    const page = 'https://a.vn/video.mp4';
    const { svc } = service({ [page]: { headers: { 'content-type': 'video/mp4' }, body: 'x' } });
    await expect(svc.fetch(new URL(page))).resolves.toBeNull();
  });
});

describe('LinkMetadataService.assertSafe', () => {
  it('host phân giải ra IP nội bộ thì ném UnsafeUrlError', async () => {
    const { svc } = service({}, { 'evil.vn': ['93.184.216.34', '10.0.0.5'] });
    await expect(svc.assertSafe(new URL('https://evil.vn/'))).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('IP viết thẳng trong URL cũng bị kiểm tra', async () => {
    const { svc } = service({});
    await expect(svc.assertSafe(new URL('http://127.0.0.1/'))).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('IPv6 dạng ánh xạ IPv4 viết thẳng trong URL cũng bị chặn', async () => {
    const { svc } = service({});
    await expect(svc.assertSafe(new URL('http://[::ffff:127.0.0.1]/'))).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
  });
});
