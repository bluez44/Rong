import type { PlaceCategory, PlaceListItem, SavedPlace } from '@rong/shared-types';

/**
 * Điểm "Muốn đi" của vùng, dạng mục danh sách để hiện ở đầu màn Vùng. Lọc theo chip như danh sách của vùng ("Tất
 * cả" bỏ lưu trú). Bỏ điểm chưa có tọa độ (dòng Google đã hết hạn): không vẽ được lên bản đồ.
 */
export function savedInRegion(items: SavedPlace[], regionId: string, categories: PlaceCategory[]): PlaceListItem[] {
  const wanted = (c: PlaceCategory) => (categories.length ? categories.includes(c) : c !== 'stay');
  return items.flatMap((s) =>
    s.regionId === regionId && s.coordinates && wanted(s.category)
      ? [
          {
            id: s.placeId,
            name: s.name,
            category: s.category,
            coordinates: s.coordinates,
            address: null,
            description: null,
            openingHours: null,
            hours: null,
            website: null,
            sourceUrl: '',
            locationSource: s.locationSource,
            articles: [],
            image: null,
          },
        ]
      : [],
  );
}

export type RegionRow =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'place'; key: string; place: PlaceListItem };

/**
 * Dòng của danh sách ở màn Vùng: mục "Muốn đi" đứng đầu, rồi các địa điểm app tìm được. Một điểm có ở cả hai mục
 * thì hiện cả hai (khóa dòng khác nhau). Không có điểm "Muốn đi" thì không có tiêu đề mục, như trước.
 */
export function regionRows(saved: PlaceListItem[], places: PlaceListItem[]): RegionRow[] {
  const rows = (prefix: string) => (place: PlaceListItem): RegionRow => ({ kind: 'place', key: `${prefix}:${place.id}`, place });
  if (saved.length === 0) return places.map(rows('region'));
  return [
    { kind: 'header', key: 'header:saved', title: `Muốn đi · ${saved.length}` },
    ...saved.map(rows('saved')),
    ...(places.length
      ? [{ kind: 'header' as const, key: 'header:region', title: 'Địa điểm trong vùng' }, ...places.map(rows('region'))]
      : []),
  ];
}
