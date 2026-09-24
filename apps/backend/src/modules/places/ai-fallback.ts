import type { PlaceCategory, PlaceListItem } from '@rong/shared-types';

import type { PlacesType } from '../../chat-models/schema.js';
import { PLACE_CATEGORIES } from './entities/place.entity.js';
import { hoursToday } from './opening-hours.js';

const HHMM = /^([01]?\d|2[0-4]):[0-5]\d$/;

/**
 * Chuyển kết quả Gemini thành mục danh sách. Gemini có thể trả tọa độ hỏng
 * hay giờ sai định dạng, nên mọi trường đều được kiểm tra trước khi dùng:
 * tọa độ ngoài Việt Nam thì bỏ cả mục, giờ sai thì để "không rõ".
 */
export function aiPlaceToListItem(
  place: PlacesType[number],
  regionName: string,
): PlaceListItem | null {
  const { lat, lng } = place.location ?? {};
  const name = place.title?.trim();
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 8 || lat > 23.6 || lng < 102 || lng > 110) return null;

  const { open, close } = place.openHours ?? {};
  const openingHours =
    open && close && HHMM.test(open) && HHMM.test(close)
      ? `${open}-${close}`
      : null;

  return {
    id: null,
    name,
    category: PLACE_CATEGORIES.includes(place.category as PlaceCategory)
      ? (place.category as PlaceCategory)
      : 'check_in',
    coordinates: { lat, lng },
    // Không có điểm tổng hợp: thứ tự giữ nguyên như Gemini trả về.
    compositeScore: 0,
    description: place.description?.trim() || null,
    openingHours,
    hours: hoursToday(openingHours),
    website: null,
    wikidataId: null,
    sourceUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${regionName}`)}`,
  };
}
