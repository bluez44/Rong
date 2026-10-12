import type { ItineraryPlaceSnapshot } from '@rong/shared-types';

import type { Candidate } from './planning.types.js';

/**
 * Tọa độ lưu vào ảnh chụp địa điểm của lịch trình. Dòng Google trả null: tọa độ
 * Google chỉ được giữ tối đa 30 ngày (PRD 7.4) nên không nằm trong JSONB, mà
 * được điền lại từ `places.location` mỗi lần đọc.
 */
export function snapshotCoordinates(
  c: Candidate,
): ItineraryPlaceSnapshot['coordinates'] {
  return c.isGoogle ? null : { lat: c.lat, lng: c.lng };
}
