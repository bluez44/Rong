import { describe, expect, it, vi } from 'vitest';

import {
  buildExtractionInput,
  extractPlaces,
  type ExtractFn,
} from './place-extraction.js';

const fake = (places: Array<Record<string, string>>): ExtractFn =>
  vi.fn(async () => ({
    places: places.map((p) => ({
      category: 'food',
      regionHint: '',
      address: '',
      quote: '',
      ...p,
    })),
  })) as unknown as ExtractFn;

describe('buildExtractionInput', () => {
  it('gộp tiêu đề, tác giả, mô tả và văn bản người dùng; bỏ phần trống', () => {
    const input = buildExtractionInput(
      {
        platform: 'tiktok',
        finalUrl: 'https://www.tiktok.com/@a/video/1',
        title: 'Bánh căn Nhà Chung',
        description: null,
        authorName: 'an.reviews',
        thumbnailUrl: null,
      },
      'Ghé Đà Lạt nhớ ăn',
    );
    expect(input).toContain('Tiêu đề: Bánh căn Nhà Chung');
    expect(input).toContain('Tác giả: an.reviews');
    expect(input).toContain('Người dùng viết: Ghé Đà Lạt nhớ ăn');
    expect(input).not.toContain('Mô tả:');
  });
});

describe('extractPlaces', () => {
  const input = 'Top quán Đà Lạt: Bánh căn Nhà Chung, Cà phê Túi Mơ To, và lẩu gà lá é Tao Ngộ.';

  it('chỉ giữ tên có trong nội dung (loại tên AI tự thêm)', async () => {
    const result = await extractPlaces(
      input,
      fake([
        { name: 'Bánh căn Nhà Chung', regionHint: 'Đà Lạt' },
        { name: 'Cà phê Túi Mơ To', category: 'cafe' },
        { name: 'Hồ Xuân Hương' }, // không có trong bài
      ]),
    );
    expect(result.map((p) => p.name)).toEqual(['Bánh căn Nhà Chung', 'Cà phê Túi Mơ To']);
    expect(result[0].regionHint).toBe('Đà Lạt');
    expect(result[1].regionHint).toBeNull();
  });

  it('khớp không dấu và gộp trùng', async () => {
    const result = await extractPlaces(
      input,
      fake([{ name: 'banh can nha chung' }, { name: 'Bánh Căn Nhà Chung' }]),
    );
    expect(result).toHaveLength(1);
  });

  it('chuỗi rỗng → null, quote cắt ở 200 ký tự, tối đa 15 mục', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `Quán Số ${i + 10}`);
    const text = many.join(', ');
    const result = await extractPlaces(
      text,
      fake(many.map((name) => ({ name, address: '', quote: 'x'.repeat(300) }))),
    );
    expect(result).toHaveLength(15);
    expect(result[0].address).toBeNull();
    expect(result[0].quote).toHaveLength(200);
  });

  it('nội dung rỗng thì không gọi Gemini', async () => {
    const extract = fake([]);
    await expect(extractPlaces('   ', extract)).resolves.toEqual([]);
    expect(extract).not.toHaveBeenCalled();
  });
});
