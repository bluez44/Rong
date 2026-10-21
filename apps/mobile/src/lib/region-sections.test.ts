import type { PlaceCategory, PlaceListItem, SavedPlace } from '@rong/shared-types';

import { regionRows, savedInRegion } from '@/lib/region-sections';

const saved = (id: string, category: PlaceCategory, regionId = 'r1', coordinates: SavedPlace['coordinates'] = { lat: 11.9, lng: 108.4 }): SavedPlace => ({
  placeId: id,
  name: `Đã lưu ${id}`,
  category,
  regionId,
  regionName: 'Đà Lạt',
  savedAt: '2026-10-21T00:00:00Z',
  coordinates,
  locationSource: 'ai',
  source: 'manual',
  notes: null,
  shareSource: null,
});
const place = (id: string) => ({ id, name: `Nơi ${id}`, category: 'nature' }) as PlaceListItem;

describe('savedInRegion', () => {
  it('chỉ lấy điểm của vùng, có tọa độ; "Tất cả" bỏ lưu trú như danh sách vùng', () => {
    const items = [saved('a', 'food'), saved('b', 'stay'), saved('c', 'cafe', 'r2'), saved('d', 'nature', 'r1', null)];
    expect(savedInRegion(items, 'r1', []).map((p) => p.id)).toEqual(['a']);
  });

  it('lọc theo chip đang chọn', () => {
    const items = [saved('a', 'food'), saved('b', 'stay'), saved('e', 'nature')];
    expect(savedInRegion(items, 'r1', ['stay', 'nature']).map((p) => p.id)).toEqual(['b', 'e']);
  });

  it('đổi sang dạng mục danh sách, giữ tọa độ và nguồn vị trí', () => {
    const [item] = savedInRegion([saved('a', 'food')], 'r1', []);
    expect(item).toMatchObject({ id: 'a', name: 'Đã lưu a', category: 'food', coordinates: { lat: 11.9, lng: 108.4 }, locationSource: 'ai', articles: [] });
  });
});

describe('regionRows', () => {
  it('không có điểm Muốn đi: chỉ các địa điểm của vùng, không tiêu đề mục', () => {
    expect(regionRows([], [place('x')]).map((r) => r.key)).toEqual(['region:x']);
  });

  it('có điểm Muốn đi: mục "Muốn đi" đứng đầu, rồi mục địa điểm của vùng; trùng vẫn hiện cả hai', () => {
    const rows = regionRows([place('x'), place('y')], [place('x'), place('z')]);
    expect(rows.map((r) => r.key)).toEqual(['header:saved', 'saved:x', 'saved:y', 'header:region', 'region:x', 'region:z']);
    expect(rows[0]).toMatchObject({ kind: 'header', title: 'Muốn đi · 2' });
    expect(rows[3]).toMatchObject({ kind: 'header', title: 'Địa điểm trong vùng' });
  });

  it('vùng chưa có địa điểm: không có tiêu đề mục rỗng', () => {
    expect(regionRows([place('x')], []).map((r) => r.key)).toEqual(['header:saved', 'saved:x']);
  });
});
