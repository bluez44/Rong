import type { Bbox } from '../regions/bbox.js';

/** Nới khung bao vùng ~2 km, cùng mức với tọa độ AI (`web-places.service.ts`). */
export const PIN_PADDING_DEG = 0.02;
/** Số điểm tự ghim mỗi người trong 24 giờ. */
export const PIN_DAILY_LIMIT = 30;
/** Tổng số điểm tự ghim mỗi người. */
export const PIN_TOTAL_LIMIT = 500;

/** Điểm nằm trong khung bao `[nam, tây, bắc, đông]` của vùng, nới `pad` độ. */
export function insideRegion(
  { lat, lng }: { lat: number; lng: number },
  bbox: Bbox,
  pad = PIN_PADDING_DEG,
): boolean {
  const [south, west, north, east] = bbox;
  return (
    lat >= south - pad &&
    lat <= north + pad &&
    lng >= west - pad &&
    lng <= east + pad
  );
}
