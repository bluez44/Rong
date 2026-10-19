import { describe, expect, it, vi } from 'vitest';

import { UnsplashClient } from './unsplash.client.js';

const photo = {
  width: 4000,
  height: 2600,
  urls: { regular: 'https://images.unsplash.com/photo-1?w=1080' },
  links: { html: 'https://unsplash.com/photos/abc', download_location: 'https://api.unsplash.com/photos/abc/download' },
  user: { name: 'Nguyễn A', links: { html: 'https://unsplash.com/@nguyena' } },
};

describe('UnsplashClient', () => {
  it('lấy ảnh ngang đầu tiên và báo lượt tải theo điều khoản API', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [photo] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const client = new UnsplashClient({ unsplashAccessKey: 'key', queueEnabled: false }, fetchImpl);

    const result = await client.searchLandscape('Đà Lạt Vietnam');
    expect(result).toEqual({
      url: 'https://images.unsplash.com/photo-1?w=1080',
      width: 4000,
      height: 2600,
      author: 'Nguyễn A',
      authorUrl: 'https://unsplash.com/@nguyena?utm_source=rong&utm_medium=referral',
      pageUrl: 'https://unsplash.com/photos/abc?utm_source=rong&utm_medium=referral',
    });
    const [searchUrl, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(searchUrl).toContain('orientation=landscape');
    expect(searchUrl).toContain(encodeURIComponent('Đà Lạt Vietnam'));
    expect((init.headers as Record<string, string>).Authorization).toBe('Client-ID key');
    expect(fetchImpl.mock.calls[1][0]).toBe(photo.links.download_location);
  });

  it('không có kết quả → null; không có key → không gọi', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    expect(
      await new UnsplashClient({ unsplashAccessKey: 'key', queueEnabled: false }, fetchImpl).searchLandscape('x'),
    ).toBeNull();
    const none = vi.fn();
    const disabled = new UnsplashClient({ unsplashAccessKey: null, queueEnabled: false }, none);
    expect(disabled.enabled).toBe(false);
    expect(await disabled.searchLandscape('x')).toBeNull();
    expect(none).not.toHaveBeenCalled();
  });

  it('HTTP lỗi → ném lỗi để job thử lại', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 403 }));
    await expect(
      new UnsplashClient({ unsplashAccessKey: 'key', queueEnabled: false }, fetchImpl).searchLandscape('x'),
    ).rejects.toThrow('403');
  });
});
