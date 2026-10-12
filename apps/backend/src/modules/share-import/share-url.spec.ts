import { describe, expect, it } from 'vitest';

import {
  detectPlatform,
  extractUrl,
  normalizeShareInput,
  normalizeShareUrl,
} from './share-url.js';

describe('extractUrl', () => {
  it('lấy URL đầu tiên trong caption, bỏ dấu câu dính cuối', () => {
    expect(
      extractUrl(
        'Quán ngon quá 😋 https://vt.tiktok.com/ZSabc123/, ghé thử nha',
      ),
    ).toBe('https://vt.tiktok.com/ZSabc123/');
    expect(extractUrl('(xem https://youtu.be/xyz).')).toBe(
      'https://youtu.be/xyz',
    );
  });

  it('không có URL thì null', () => {
    expect(extractUrl('Bánh căn Nhà Chung, Đà Lạt')).toBeNull();
  });
});

describe('normalizeShareUrl', () => {
  it('bỏ tham số theo dõi, giữ tham số cần thiết', () => {
    expect(
      normalizeShareUrl(
        'https://www.youtube.com/watch?v=abc&si=XYZ&utm_source=share&feature=shared',
      )?.toString(),
    ).toBe('https://www.youtube.com/watch?v=abc&feature=shared');
    expect(
      normalizeShareUrl(
        'https://www.instagram.com/reel/C1/?igsh=abc',
      )?.toString(),
    ).toBe('https://www.instagram.com/reel/C1/');
  });

  it('từ chối scheme lạ, cổng lạ, quá dài', () => {
    expect(normalizeShareUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeShareUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeShareUrl('http://example.com:8080/')).toBeNull();
    expect(normalizeShareUrl(`https://a.vn/${'x'.repeat(2100)}`)).toBeNull();
    expect(normalizeShareUrl('khong phai url')).toBeNull();
  });

  it('từ chối URL có user:pass', () => {
    expect(normalizeShareUrl('https://u:p@example.com/')).toBeNull();
  });
});

describe('detectPlatform', () => {
  it.each([
    ['https://www.tiktok.com/@a/video/1', 'tiktok'],
    ['https://vt.tiktok.com/ZS1/', 'tiktok'],
    ['https://youtu.be/x', 'youtube'],
    ['https://m.youtube.com/shorts/x', 'youtube'],
    ['https://www.facebook.com/share/r/1', 'facebook'],
    ['https://fb.watch/abc', 'facebook'],
    ['https://www.instagram.com/p/x', 'instagram'],
    ['https://vnexpress.net/bai-viet', 'web'],
    ['https://nottiktok.com/', 'web'],
  ])('%s → %s', (url, platform) => {
    expect(detectPlatform(new URL(url))).toBe(platform);
  });
});

describe('normalizeShareInput', () => {
  it('URL nằm trong text thì tách ra, text vẫn giữ làm mô tả', () => {
    const result = normalizeShareInput({ text: 'Đẹp lắm https://youtu.be/x' });
    expect(result?.url?.toString()).toBe('https://youtu.be/x');
    expect(result?.text).toBe('Đẹp lắm https://youtu.be/x');
  });

  it('chỉ có text không URL vẫn hợp lệ; cắt ở 5000 ký tự', () => {
    const result = normalizeShareInput({ text: 'a'.repeat(6000) });
    expect(result?.url).toBeNull();
    expect(result?.text).toHaveLength(5000);
  });

  it('url sai và text rỗng thì null', () => {
    expect(normalizeShareInput({ url: 'ftp://x', text: '   ' })).toBeNull();
    expect(normalizeShareInput({})).toBeNull();
  });
});
