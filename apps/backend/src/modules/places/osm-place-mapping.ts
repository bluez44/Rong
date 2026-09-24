import type { PlaceCategory } from '@rong/shared-types';

import type { OverpassElement } from '../open-data/open-data.types.js';

/**
 * Bộ lọc Overpass cho từng nhóm. Tách "tham quan" và "dịch vụ" thành hai truy
 * vấn riêng để quán ăn, khách sạn (rất nhiều) không đẩy các điểm tham quan ra
 * khỏi giới hạn số kết quả.
 */
export const SIGHT_FILTERS = [
  '["tourism"~"^(attraction|viewpoint|museum|gallery|theme_park|zoo|aquarium)$"]',
  '["historic"]',
  '["natural"~"^(beach|peak|waterfall|cave_entrance|bay|hot_spring|volcano)$"]',
  '["waterway"="waterfall"]',
  '["leisure"~"^(park|garden|nature_reserve|water_park)$"]',
  '["boundary"="national_park"]',
  '["amenity"~"^(place_of_worship|theatre|arts_centre)$"]["wikidata"]',
  '["amenity"="place_of_worship"]["tourism"]',
];

export const SERVICE_FILTERS = [
  '["tourism"~"^(hotel|resort|guest_house|hostel|motel)$"]',
  '["amenity"~"^(cafe|restaurant|food_court|bar|pub|nightclub)$"]',
];

/** Tag được giữ lại để hiển thị; phần còn lại của OSM không cần lưu. */
const KEPT_TAGS = [
  'name:en',
  'opening_hours',
  'website',
  'contact:website',
  'phone',
  'contact:phone',
  'image',
  'wikimedia_commons',
  'wikipedia',
  'tourism',
  'amenity',
  'historic',
  'natural',
  'leisure',
  'cuisine',
  'fee',
];

const match = (value: string | undefined, allowed: string[]): boolean =>
  value !== undefined && allowed.includes(value);

/**
 * Xếp một phần tử OSM vào danh mục của app. Thứ tự kiểm tra có chủ ý: một
 * ngôi chùa gắn cả `tourism=attraction` là "văn hóa", một công viên gắn
 * `tourism=attraction` là "thiên nhiên" — nhãn cụ thể thắng nhãn chung.
 * Trả về null nếu không thuộc danh mục nào.
 */
export function classifyPlace(
  tags: Record<string, string>,
): PlaceCategory | null {
  const { tourism, amenity, historic, natural, leisure, waterway, boundary } =
    tags;

  if (match(tourism, ['hotel', 'resort', 'guest_house', 'hostel', 'motel']))
    return 'stay';
  if (
    match(tourism, ['theme_park', 'zoo', 'aquarium']) ||
    leisure === 'water_park'
  )
    return 'kids';
  if (
    match(tourism, ['museum', 'gallery']) ||
    (historic !== undefined && historic !== 'no') ||
    match(amenity, ['theatre', 'arts_centre']) ||
    (amenity === 'place_of_worship' &&
      (tags.wikidata !== undefined || tourism !== undefined))
  ) {
    return 'culture';
  }
  if (
    match(natural, [
      'beach',
      'peak',
      'waterfall',
      'cave_entrance',
      'bay',
      'hot_spring',
      'volcano',
    ]) ||
    waterway === 'waterfall' ||
    match(leisure, ['park', 'garden', 'nature_reserve']) ||
    boundary === 'national_park'
  ) {
    return 'nature';
  }
  if (match(tourism, ['attraction', 'viewpoint'])) return 'check_in';
  if (match(amenity, ['bar', 'pub', 'nightclub'])) return 'nightlife';
  if (amenity === 'cafe') return 'cafe';
  if (match(amenity, ['restaurant', 'food_court'])) return 'food';
  return null;
}

export interface PlaceDraft {
  osmType: string;
  osmId: number;
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  tags: Record<string, string>;
  wikidataId: string | null;
}

/** Chuyển phần tử Overpass thành bản nháp địa điểm; bỏ những gì không phân loại hoặc không có tọa độ. */
export function toPlaceDraft(element: OverpassElement): PlaceDraft | null {
  const tags = element.tags ?? {};
  const name = tags['name:vi'] ?? tags.name;
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  const category = classifyPlace(tags);

  if (!name || lat === undefined || lng === undefined || category === null) {
    return null;
  }

  const kept: Record<string, string> = {};
  for (const key of KEPT_TAGS) {
    if (tags[key] !== undefined) kept[key] = tags[key];
  }

  return {
    osmType: element.type,
    osmId: element.id,
    name: name.trim(),
    category,
    lat,
    lng,
    tags: kept,
    wikidataId: /^Q\d+$/.test(tags.wikidata ?? '') ? tags.wikidata : null,
  };
}
