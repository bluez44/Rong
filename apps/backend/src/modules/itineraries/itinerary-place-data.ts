import type { ItineraryDay } from '@rong/shared-types';
import type { DataSource } from 'typeorm';

import { toNotes, type NotesRow } from '../places/place-notes.js';

/**
 * Bổ sung địa chỉ riêng của Rong và tọa độ Google còn hạn vào các ngày lịch trình.
 * Địa chỉ/nội dung Google không được lưu trong `places.address` hay JSONB lịch trình.
 */
export async function withItineraryPlaceData(
  db: DataSource,
  days: ItineraryDay[],
  notesOwnerId: string | null = null,
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
            CASE WHEN (location_source = 'google' AND location_expires_at > now()) OR location_source = 'user'
                 THEN ST_Y(location) END AS lat,
            CASE WHEN (location_source = 'google' AND location_expires_at > now()) OR location_source = 'user'
                 THEN ST_X(location) END AS lng
       FROM places
      WHERE id = ANY($1::uuid[])`,
    [ids],
  )) as Array<{
    id: string;
    source: 'google' | 'web' | 'user';
    location_source: 'google' | 'ai' | 'user';
    address: string | null;
    lat: number | null;
    lng: number | null;
  }>;
  if (rows.length === 0) return days;
  const current = new Map(rows.map((row) => [row.id, row]));
  // Ghi chú của người tạo lịch trình, đọc mỗi lần trả (một bản với "Muốn đi", không lưu trong lịch trình).
  const notes = notesOwnerId
    ? new Map(
        (
          (await db.query(
            `SELECT place_id, note, opening_hours, price_min, price_max
               FROM place_notes WHERE user_id = $1 AND place_id = ANY($2::uuid[])`,
            [notesOwnerId, ids],
          )) as NotesRow[]
        ).map((row) => [row.place_id, toNotes(row)]),
      )
    : null;
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
          // Google: tọa độ còn hạn; điểm tự ghim: vị trí mới nhất (người tạo có thể dời ghim).
          ...(place.location_source === 'google' ||
          place.location_source === 'user'
            ? {
                coordinates:
                  place.lat === null || place.lng === null
                    ? null
                    : { lat: Number(place.lat), lng: Number(place.lng) },
              }
            : {}),
          ...(notes ? { notes: notes.get(place.id) ?? null } : {}),
        },
      };
    }),
  }));
}
