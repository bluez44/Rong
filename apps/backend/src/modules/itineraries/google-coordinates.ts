import type { ItineraryDay } from '@rong/shared-types';
import type { DataSource } from 'typeorm';

/**
 * Điền tọa độ hiện tại cho địa điểm nguồn Google trong các ngày của lịch trình
 * (PRD 7.4: JSONB không lưu tọa độ Google). Lấy từ `places.location`; đã hết hạn
 * hoặc chưa lấy lại thì null. Địa điểm OSM giữ nguyên ảnh chụp.
 */
export async function withGoogleCoordinates(
  db: DataSource,
  days: ItineraryDay[],
): Promise<ItineraryDay[]> {
  const ids = [
    ...new Set(
      days.flatMap((d) =>
        d.items.flatMap((i) => (i.placeId && i.place ? [i.placeId] : [])),
      ),
    ),
  ];
  if (ids.length === 0) return days;
  const rows = (await db.query(
    `SELECT id,
            CASE WHEN location_expires_at > now() THEN ST_Y(location) END AS lat,
            CASE WHEN location_expires_at > now() THEN ST_X(location) END AS lng
       FROM places
      WHERE id = ANY($1::uuid[]) AND source = 'google'`,
    [ids],
  )) as Array<{ id: string; lat: number | null; lng: number | null }>;
  if (rows.length === 0) return days;
  const current = new Map(
    rows.map((r) => [
      r.id,
      r.lat === null || r.lng === null
        ? null
        : { lat: Number(r.lat), lng: Number(r.lng) },
    ]),
  );
  return days.map((day) => ({
    ...day,
    items: day.items.map((item) =>
      item.placeId && item.place && current.has(item.placeId)
        ? {
            ...item,
            place: { ...item.place, coordinates: current.get(item.placeId)! },
          }
        : item,
    ),
  }));
}
