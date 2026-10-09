import { describe, expect, it, vi } from 'vitest';

import {
  findPlacesFromWeb,
  type PlaceSearchDeps,
} from './place-search.service.js';
import type { WebSource } from './web-search.js';

const source = (uri: string): WebSource => ({
  title: uri,
  uri,
  content: `Bài ${uri}`,
  publishedAt: null,
});

const place = (title: string) => ({
  title,
  description: '',
  address: '',
  location: { lat: 11.94, lng: 108.44 },
  category: 'nature' as const,
  openHours: { open: '', close: '' },
});

const THREE = [
  source('https://a.vn'),
  source('https://b.vn'),
  source('https://c.vn'),
];

function deps(search: PlaceSearchDeps['search'], count = 1) {
  const extract = vi.fn<PlaceSearchDeps['extract']>(async () => ({
    places: Array.from({ length: count }, (_, i) => place(`P${i}`)),
  }));
  const agent = vi.fn<PlaceSearchDeps['agent']>(async () => ({
    places: [place('Thác A')],
    sources: [source('https://a.vn'), source('https://moi.vn')],
  }));
  return { search: vi.fn(search), extract, agent };
}

describe('findPlacesFromWeb — đường nhanh', () => {
  it('chạy các truy vấn song song, gộp bài trùng, gọi Gemini đúng một lần', async () => {
    const d = deps(async (query) =>
      query.startsWith('quán ăn') ? THREE : [source('https://a.vn')],
    );

    const result = await findPlacesFromWeb('Đà Lạt', d);

    expect(d.search).toHaveBeenCalledTimes(3);
    expect(d.search.mock.calls.every(([q]) => q.endsWith('Đà Lạt'))).toBe(true);
    expect(result.sources.map((s) => s.uri)).toEqual([
      'https://a.vn',
      'https://b.vn',
      'https://c.vn',
    ]);
    expect(d.extract).toHaveBeenCalledTimes(1);
    expect(d.agent).not.toHaveBeenCalled();
    const [, request] = d.extract.mock.calls[0];
    expect(request).toContain('URL: https://a.vn');
    expect(request).toContain('URL: https://c.vn');
    expect(result.places.map((p) => p.title)).toEqual(['P0']);
  });

  it('một truy vấn lỗi thì dùng các truy vấn còn lại', async () => {
    let calls = 0;
    const d = deps(async () => {
      if (calls++ === 0) throw new Error('Tavily 500');
      return THREE;
    });
    await expect(findPlacesFromWeb('Huế', d)).resolves.toMatchObject({
      sources: [
        { uri: 'https://a.vn' },
        { uri: 'https://b.vn' },
        { uri: 'https://c.vn' },
      ],
    });
    expect(d.agent).not.toHaveBeenCalled();
  });

  it('mọi truy vấn lỗi thì ném lỗi, không gọi agent', async () => {
    const d = deps(() => Promise.reject(new Error('Tavily 401')));
    await expect(findPlacesFromWeb('Huế', d)).rejects.toThrow('Tavily 401');
    expect(d.agent).not.toHaveBeenCalled();
  });

  it('giữ tối đa 15 địa điểm', async () => {
    const d = deps(async () => THREE, 20);
    expect((await findPlacesFromWeb('Huế', d)).places).toHaveLength(15);
  });
});

describe('findPlacesFromWeb — chuyển sang agent', () => {
  it('ít bài thì agent tìm thêm, nhận sẵn bài đã có; nguồn gộp cả hai', async () => {
    const d = deps(async () => [source('https://a.vn')]);

    const result = await findPlacesFromWeb('Xã Tà Xùa', d);

    expect(d.extract).not.toHaveBeenCalled();
    expect(d.agent).toHaveBeenCalledTimes(1);
    expect(d.agent.mock.calls[0][0]).toContain('URL: https://a.vn');
    expect(result.places.map((p) => p.title)).toEqual(['Thác A']);
    expect(result.sources.map((s) => s.uri)).toEqual([
      'https://a.vn',
      'https://moi.vn',
    ]);
  });

  it('không có bài nào cũng thử agent', async () => {
    const d = deps(async () => []);
    await findPlacesFromWeb('Xã Tà Xùa', d);
    expect(d.agent.mock.calls[0][0]).toContain('(chưa có bài nào)');
  });

  it('agent lỗi thì ném lỗi', async () => {
    const d = deps(async () => []);
    d.agent.mockRejectedValue(new Error('Gemini 500'));
    await expect(findPlacesFromWeb('Xã Tà Xùa', d)).rejects.toThrow(
      'Gemini 500',
    );
  });
});
