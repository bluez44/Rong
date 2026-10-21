import { describe, expect, it, vi } from 'vitest';

import type { RegionRef } from './region-lookup.service.js';
import { resolvePlaces, type ResolverDeps } from './place-resolver.js';

const DA_LAT: RegionRef = {
  id: 'r-dalat',
  name: 'Đà Lạt',
  bbox: [11.8, 108.3, 12.1, 108.6],
};
const place = (name: string, regionHint: string | null = 'Đà Lạt') => ({
  name,
  category: 'food' as const,
  regionHint,
  address: null,
  quote: `nhắc ${name}`,
});

function deps(over: Partial<ResolverDeps> = {}): ResolverDeps {
  return {
    findRegion: vi.fn(async (hint: string) =>
      hint === 'Đà Lạt' ? DA_LAT : null,
    ),
    matchCatalog: vi.fn(async () => null),
    searchGoogle: vi.fn(async () => []),
    assignRegions: vi.fn(async (points) => points.map(() => 'r-dalat')),
    ...over,
  };
}

describe('resolvePlaces', () => {
  it('khớp danh mục → high, một lựa chọn catalog; không gọi Google', async () => {
    const d = deps({
      matchCatalog: vi.fn(async () => ({
        placeId: 'p1',
        lat: 11.94,
        lng: 108.44,
      })),
    });
    const [c] = await resolvePlaces([place('Bánh căn Nhà Chung')], d);
    expect(c).toMatchObject({
      key: 'c1',
      confidence: 'high',
      options: [{ kind: 'catalog', placeId: 'p1', regionId: 'r-dalat' }],
    });
    expect(d.matchCatalog).toHaveBeenCalledWith(
      'Bánh căn Nhà Chung',
      DA_LAT.bbox,
    );
    expect(d.searchGoogle).not.toHaveBeenCalled();
  });

  it('Google: kết quả đầu trong vùng gợi ý → high, chỉ giữ kết quả đầu', async () => {
    const d = deps({
      searchGoogle: vi.fn(async () => [
        { placeId: 'g1', lat: 11.94, lng: 108.44 },
        { placeId: 'g2', lat: 11.95, lng: 108.45 },
      ]),
    });
    const [c] = await resolvePlaces([place('Quán Mới')], d);
    expect(c.confidence).toBe('high');
    expect(c.options).toEqual([
      {
        kind: 'google',
        googlePlaceId: 'g1',
        lat: 11.94,
        lng: 108.44,
        regionId: 'r-dalat',
      },
    ]);
    expect(d.searchGoogle).toHaveBeenCalledWith(
      'Quán Mới, Đà Lạt',
      DA_LAT.bbox,
    );
  });

  it('Google: không có vùng gợi ý hoặc kết quả ngoài vùng → low, tối đa 3', async () => {
    const d = deps({
      searchGoogle: vi.fn(async () => [
        { placeId: 'g1', lat: 10.7, lng: 106.7 },
        { placeId: 'g2', lat: 21.0, lng: 105.8 },
        { placeId: 'g3', lat: 16.0, lng: 108.2 },
        { placeId: 'g4', lat: 12.2, lng: 109.1 },
      ]),
    });
    const [c] = await resolvePlaces([place('Quán Mới', null)], d);
    expect(c.confidence).toBe('low');
    expect(
      c.options.map((o) => (o.kind === 'google' ? o.googlePlaceId : '')),
    ).toEqual(['g1', 'g2', 'g3']);
  });

  it('lựa chọn không thuộc vùng nào bị bỏ', async () => {
    const d = deps({
      searchGoogle: vi.fn(async () => [
        { placeId: 'g1', lat: 11.94, lng: 108.44 },
      ]),
      assignRegions: vi.fn(async () => [null]),
    });
    const [c] = await resolvePlaces([place('Quán Mới')], d);
    expect(c).toMatchObject({ confidence: 'none', options: [] });
  });

  it('Google lỗi → chỉ dùng danh mục, không ném lỗi', async () => {
    const d = deps({
      searchGoogle: vi.fn(async () => {
        throw new Error('quota');
      }),
    });
    const [c] = await resolvePlaces([place('Quán Mới')], d);
    expect(c).toMatchObject({ confidence: 'none', options: [] });
  });

  it('Google lỗi → ghi một cảnh báo gộp cho cả lượt (số lỗi + các thông báo khác nhau)', async () => {
    const warn = vi.fn();
    let n = 0;
    const d = deps({
      searchGoogle: vi.fn(async () => {
        throw new Error(n++ === 2 ? 'timeout' : 'quota');
      }),
      warn,
    });
    await resolvePlaces([place('Quán A'), place('Quán B'), place('Quán C')], d);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      'Google Text Search lỗi 3/3 lượt, chỉ dùng danh mục: quota; timeout',
    );
  });

  it('Google không lỗi → không cảnh báo', async () => {
    const warn = vi.fn();
    await resolvePlaces([place('Quán A')], deps({ warn }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('không có vùng gợi ý thì khớp danh mục toàn quốc với ngưỡng chặt hơn', async () => {
    const d = deps();
    await resolvePlaces([place('Chợ Bến Thành', null)], d);
    expect(d.matchCatalog).toHaveBeenCalledWith('Chợ Bến Thành', null);
  });
  it('ứng viên không khớp vẫn giữ vùng gợi ý (để người dùng tự ghim); không có gợi ý thì null', async () => {
    const [hinted, plain] = await resolvePlaces(
      [place('Quán Không Ai Biết'), place('Quán Vô Danh', null)],
      deps(),
    );
    expect(hinted).toMatchObject({
      confidence: 'none',
      options: [],
      regionHintId: 'r-dalat',
    });
    expect(plain).toMatchObject({
      confidence: 'none',
      options: [],
      regionHintId: null,
    });
  });
});
