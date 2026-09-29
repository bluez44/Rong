import type {
  Itinerary,
  ItineraryItem,
  PlaceCategory,
  UpdateItineraryRequest,
} from '@rong/shared-types';

import { formatTime } from '@/lib/trip-format';

/**
 * Các thao tác sửa lịch trình (F8) trên bản sao cục bộ. Giờ, thời gian di
 * chuyển và cảnh báo do server tính lại sau mỗi lần lưu; ở đây chỉ đổi thứ tự,
 * thời lượng và giờ ghim để màn hình phản hồi ngay.
 */

/** Địa điểm có trong danh mục, đủ để thêm vào lịch. */
export type EditPlace = { id: string; name: string; category: PlaceCategory };

/** Thời lượng mặc định khi thêm điểm mới, phút. */
export function defaultDuration(category: PlaceCategory): number {
  if (category === 'food') return 60;
  if (category === 'cafe') return 45;
  if (category === 'stay') return 90;
  return 90;
}

export function durationOf(item: ItineraryItem): number {
  return Math.max(5, Math.round((Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60000));
}

/** UUID v4 cho mục mới: server giữ nguyên id client gửi lên. */
export function newId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function toRequest(itinerary: Itinerary): UpdateItineraryRequest {
  return {
    days: itinerary.days.map((day) => ({
      id: day.id,
      items: day.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        placeId: item.placeId,
        mealType: item.mealType ?? null,
        durationMinutes: durationOf(item),
        startTime: item.fixedStart ? formatTime(item.startsAt) : null,
        reason: item.reason ?? null,
        isAiSuggested: item.isAiSuggested,
      })),
    })),
    unscheduledPlaceIds: itinerary.unscheduled.map((u) => u.placeId),
  };
}

/** Vị trí của mục trong lịch trình. */
export function locate(itinerary: Itinerary, itemId: string): { day: number; index: number } | null {
  for (const [day, d] of itinerary.days.entries()) {
    const index = d.items.findIndex((i) => i.id === itemId);
    if (index >= 0) return { day, index };
  }
  return null;
}

function withDays(itinerary: Itinerary, update: (days: ItineraryItem[][]) => void): Itinerary {
  const days = itinerary.days.map((d) => [...d.items]);
  update(days);
  return {
    ...itinerary,
    days: itinerary.days.map((d, i) => ({ ...d, items: days[i].map((item, order) => ({ ...item, order })) })),
  };
}

export function reorder(itinerary: Itinerary, day: number, from: number, to: number): Itinerary {
  return withDays(itinerary, (days) => {
    const [item] = days[day].splice(from, 1);
    days[day].splice(to, 0, item);
  });
}

/** Chuyển sang cuối ngày khác; bỏ giờ ghim vì giờ đó thuộc ngày cũ. */
export function moveToDay(itinerary: Itinerary, itemId: string, targetDay: number): Itinerary {
  const at = locate(itinerary, itemId);
  if (!at || at.day === targetDay) return itinerary;
  return withDays(itinerary, (days) => {
    const [item] = days[at.day].splice(at.index, 1);
    days[targetDay].push({ ...item, fixedStart: false });
  });
}

export function removeItem(itinerary: Itinerary, itemId: string): Itinerary {
  const at = locate(itinerary, itemId);
  if (!at) return itinerary;
  return withDays(itinerary, (days) => {
    days[at.day].splice(at.index, 1);
  });
}

/** Bỏ khỏi ngày nhưng giữ trong "Chưa xếp" để xếp lại sau. */
export function unschedule(itinerary: Itinerary, itemId: string): Itinerary {
  const at = locate(itinerary, itemId);
  const item = at ? itinerary.days[at.day].items[at.index] : null;
  if (!item?.placeId) return removeItem(itinerary, itemId);
  const placeId = item.placeId;
  const next = removeItem(itinerary, itemId);
  if (next.unscheduled.some((u) => u.placeId === placeId)) return next;
  return {
    ...next,
    unscheduled: [...next.unscheduled, { placeId, name: item.place?.name, reason: 'Chờ bạn xếp vào lịch' }],
  };
}

/** Thêm địa điểm vào cuối ngày; nếu nó đang nằm ở "Chưa xếp" thì lấy ra. */
export function addPlace(itinerary: Itinerary, day: number, place: EditPlace): Itinerary {
  const target = itinerary.days[day];
  const last = target.items.at(-1);
  const start = last ? last.endsAt : target.startsAt;
  const minutes = defaultDuration(place.category);
  const item: ItineraryItem = {
    id: newId(),
    kind: place.category === 'food' ? 'meal' : 'visit',
    placeId: place.id,
    place: { name: place.name, category: place.category, coordinates: { lat: 0, lng: 0 } },
    mealType: null,
    dayPart: last?.dayPart ?? 'morning',
    order: target.items.length,
    startsAt: start,
    endsAt: new Date(Date.parse(start) + minutes * 60000).toISOString(),
    travelMinutesFromPrevious: null,
    distanceKmFromPrevious: null,
    reason: null,
    isAiSuggested: false,
    fixedStart: false,
  };
  const next = withDays(itinerary, (days) => {
    days[day].push(item);
  });
  return { ...next, unscheduled: next.unscheduled.filter((u) => u.placeId !== place.id) };
}

/** Bỏ hẳn một điểm khỏi "Chưa xếp". */
export function dropUnscheduled(itinerary: Itinerary, placeId: string): Itinerary {
  return { ...itinerary, unscheduled: itinerary.unscheduled.filter((u) => u.placeId !== placeId) };
}

/** Đổi điểm tương tự (FR-8.3): giữ vị trí, thời lượng và giờ ghim. */
export function replacePlace(itinerary: Itinerary, itemId: string, place: EditPlace): Itinerary {
  return mapItem(itinerary, itemId, (item) => ({
    ...item,
    placeId: place.id,
    place: { name: place.name, category: place.category, coordinates: { lat: 0, lng: 0 } },
    reason: null,
    isAiSuggested: false,
  }));
}

/** Đổi thời lượng và/hoặc giờ ghim (`startTime` null = nối tiếp mục trước). */
export function setTiming(itinerary: Itinerary, itemId: string, minutes: number, startTime: string | null): Itinerary {
  return mapItem(itinerary, itemId, (item) => {
    const start = startTime ? replaceClock(item.startsAt, startTime) : item.startsAt;
    return {
      ...item,
      fixedStart: startTime !== null,
      startsAt: start,
      endsAt: new Date(Date.parse(start) + minutes * 60000).toISOString(),
    };
  });
}

function mapItem(itinerary: Itinerary, itemId: string, update: (item: ItineraryItem) => ItineraryItem): Itinerary {
  return {
    ...itinerary,
    days: itinerary.days.map((d) => ({ ...d, items: d.items.map((i) => (i.id === itemId ? update(i) : i)) })),
  };
}

/** Đặt giờ "HH:mm" (giờ Việt Nam) cho cùng ngày của `iso`. */
function replaceClock(iso: string, clock: string): string {
  const [h, m] = clock.split(':').map(Number);
  const vn = new Date(Date.parse(iso) + 7 * 3600_000);
  vn.setUTCHours(h, m, 0, 0);
  return new Date(vn.getTime() - 7 * 3600_000).toISOString();
}

/** "HH:mm" cộng `delta` phút, giữ trong 00:00–23:45. */
export function shiftClock(clock: string, delta: number): string {
  const [h, m] = clock.split(':').map(Number);
  const total = Math.min(Math.max(h * 60 + m + delta, 0), 23 * 60 + 45);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
