import { randomUUID } from 'node:crypto';

import type {
  ItineraryEditItem,
  ItineraryItem,
  ItineraryWarning,
  Transport,
} from '@rong/shared-types';

import { parseOpeningHours } from '../../places/opening-hours.js';
import { vietnamIso, type DayWindow } from './days.js';
import type { Candidate } from './planning.types.js';
import { MEALS } from './rules.js';
import { estimateLeg, type LatLng } from './travel.js';

/** FR-8.6: chặng di chuyển dài hơn thì cảnh báo. */
export const LONG_LEG_MINUTES = 60;
/** FR-8.6: một ngày hoạt động lâu hơn thì cảnh báo. */
export const LONG_DAY_MINUTES = 10 * 60;
const LAST_MINUTE = 24 * 60 - 1;

export interface RetimeContext {
  day: DayWindow;
  transport: Transport;
  accommodation: Candidate | null;
  /** Địa điểm trong danh mục theo id, đủ cho mọi `placeId` của ngày. */
  places: Map<string, Candidate>;
}

export interface RetimedDay {
  items: ItineraryItem[];
  warnings: ItineraryWarning[];
}

/** "HH:mm" → phút trong ngày; null nếu sai định dạng. */
export function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Tính lại giờ cho một ngày sau khi người dùng sửa (F8, FR-8.5): giữ nguyên
 * thứ tự và mọi mục người dùng đặt, mục sau nối tiếp mục trước cộng thời gian
 * di chuyển, không sớm hơn giờ người dùng ghim. Khác với lúc tạo (scheduler.ts),
 * không bỏ hay chèn mục nào: chỗ bất hợp lý chỉ được cảnh báo (FR-8.6).
 */
export function retimeDay(
  edits: ItineraryEditItem[],
  ctx: RetimeContext,
): RetimedDay {
  const { day, transport, accommodation, places } = ctx;
  const dayId = `day-${day.index + 1}`;
  const label = `Ngày ${day.index + 1}`;
  const items: ItineraryItem[] = [];
  const warnings: ItineraryWarning[] = [];

  let cursor = day.start;
  // Như lúc tạo: các ngày sau ngày đầu bắt đầu từ nơi ở.
  let here: LatLng | null =
    accommodation && !day.isFirst ? accommodation : null;

  edits.forEach((edit, order) => {
    const place = edit.placeId ? (places.get(edit.placeId) ?? null) : null;
    const leg = here && place ? estimateLeg(here, place, transport) : null;
    const pinned = edit.startTime ? parseClock(edit.startTime) : null;
    const start = Math.min(
      Math.max(cursor + (leg?.minutes ?? 0), pinned ?? 0),
      LAST_MINUTE,
    );
    const end = Math.min(start + edit.durationMinutes, LAST_MINUTE);
    const id = edit.id ?? randomUUID();

    if (leg && leg.minutes > LONG_LEG_MINUTES && place) {
      warnings.push({
        type: 'long_travel_leg',
        message: `${label}: chặng tới ${place.name} mất khoảng ${leg.minutes} phút.`,
        dayId,
        itemId: id,
      });
    }
    if (place && edit.kind !== 'rest') {
      const closed = closedMessage(place, day.weekday, start, end);
      if (closed) {
        warnings.push({
          type: 'place_closed',
          message: `${label}: ${place.name} ${closed}.`,
          dayId,
          itemId: id,
        });
      }
    }

    items.push({
      id,
      kind: edit.kind,
      placeId: edit.placeId ?? null,
      place: place
        ? {
            name: place.name,
            category: place.category,
            coordinates: { lat: place.lat, lng: place.lng },
          }
        : null,
      mealType: edit.kind === 'meal' ? (edit.mealType ?? null) : null,
      dayPart: dayPartOf(start),
      order,
      startsAt: vietnamIso(day.date, start),
      endsAt: vietnamIso(day.date, end),
      travelMinutesFromPrevious: leg?.minutes ?? null,
      distanceKmFromPrevious: leg?.km ?? null,
      reason: edit.reason ?? null,
      isAiSuggested: edit.isAiSuggested ?? false,
      fixedStart: pinned !== null,
    });

    cursor = end;
    if (place) here = place;
  });

  if (items.length > 0) {
    const first = minuteOf(items[0].startsAt);
    const last = minuteOf(items[items.length - 1].endsAt);
    if (last - first > LONG_DAY_MINUTES) {
      warnings.push({
        type: 'overloaded_day',
        message: `${label} có hơn 10 tiếng hoạt động (${clock(first)}–${clock(last)}).`,
        dayId,
      });
    } else if (last > day.end) {
      warnings.push({
        type: 'overloaded_day',
        message: `${label} kết thúc lúc ${clock(last)}, trễ hơn dự kiến (${clock(day.end)}).`,
        dayId,
      });
    }
  }

  warnings.push(...missingMeals(items, day, label, dayId));
  return { items, warnings };
}

/**
 * FR-8.6 "thiếu bữa trưa hoặc bữa tối": bữa nằm trong khung giờ của ngày mà
 * không có mục bữa ăn, hay điểm ăn uống, nào rơi vào khung giờ đó.
 */
function missingMeals(
  items: ItineraryItem[],
  day: DayWindow,
  label: string,
  dayId: string,
): ItineraryWarning[] {
  return MEALS.filter((meal) => meal.type !== 'breakfast')
    .filter((meal) => day.start <= meal.start && meal.end <= day.end)
    .filter(
      (meal) =>
        !items.some((item) => {
          if (item.kind === 'meal' && item.mealType) {
            return item.mealType === meal.type;
          }
          if (item.kind !== 'meal' && item.place?.category !== 'food') {
            return false;
          }
          const start = minuteOf(item.startsAt);
          return start >= meal.start - 30 && start <= meal.end;
        }),
    )
    .map((meal) => ({
      type: 'missing_meal' as const,
      message: `${label}: chưa có bữa ${meal.type === 'lunch' ? 'trưa' : 'tối'}.`,
      dayId,
    }));
}

/** Chỉ dựa vào giờ mở cửa thật của danh mục; không có thì không cảnh báo. */
function closedMessage(
  place: Candidate,
  weekday: number,
  start: number,
  end: number,
): string | null {
  const week = place.openingHours
    ? parseOpeningHours(place.openingHours)
    : null;
  if (!week) return null;
  const ranges = week[weekday];
  if (ranges.length === 0) return 'đóng cửa ngày này';
  const fits = ranges.some(([open, close]) => start >= open && end <= close);
  if (fits) return null;
  const hours = ranges.map(([o, c]) => `${clock(o)}–${clock(c)}`).join(', ');
  return `chỉ mở ${hours}, lịch đang đặt ${clock(start)}–${clock(end)}`;
}

function dayPartOf(minute: number): ItineraryItem['dayPart'] {
  if (minute < 11 * 60) return 'morning';
  if (minute < 14 * 60) return 'noon';
  if (minute < 18 * 60) return 'afternoon';
  return 'evening';
}

/** Phút trong ngày của chuỗi do `vietnamIso` tạo ("YYYY-MM-DDTHH:mm:00+07:00"). */
function minuteOf(iso: string): number {
  return Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
}

function clock(minute: number): string {
  const m = Math.min(minute, LAST_MINUTE);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
