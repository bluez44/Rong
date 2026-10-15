import type { ItineraryDay } from '@rong/shared-types';
import type { DataSource } from 'typeorm';

/**
 * Bổ sung địa chỉ riêng của Rong và tọa độ Google còn hạn vào các ngày lịch trình.
 * Địa chỉ/nội dung Google không được lưu trong `places.address` hay JSONB lịch trình.
 */
export async function withItineraryPlaceData(
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
    `SELECT id, source, location_source, address,
            CASE WHEN location_source = 'google' AND location_expires_at > now() THEN ST_Y(location) END AS lat,
            CASE WHEN location_source = 'google' AND location_expires_at > now() THEN ST_X(location) END AS lng
       FROM places
      WHERE id = ANY($1::uuid[])`,
    [ids],
  )) as Array<{
    id: string;
    source: 'osm' | 'google' | 'web';
    location_source: 'osm' | 'google' | 'ai';
    address: string | null;
    lat: number | null;
    lng: number | null;
  }>;
  if (rows.length === 0) return days;
  const current = new Map(rows.map((row) => [row.id, row]));
  return days.map((day) => ({
    ...day,
    items: day.items.map((item) => {
      const place = item.placeId ? current.get(item.placeId) : undefined;
      if (!place || !item.place) return item;
      return {
        ...item,
        place: {
          ...item.place,
          address:
            place.source === 'google'
              ? null
              : (place.address ?? item.place.address ?? null),
          ...(place.location_source === 'google'
            ? {
                coordinates:
                  place.lat === null || place.lng === null
                    ? null
                    : { lat: Number(place.lat), lng: Number(place.lng) },
              }
            : {}),
        },
      };
    }),
  }));
}
