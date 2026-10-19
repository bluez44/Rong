import type { ItineraryDay, ItineraryInput } from '@rong/shared-types';

import { toVietnamLocal, vietnamIso } from '../itineraries/planning/days.js';

/**
 * Mọi bản nháp trong kho xếp từ ngày này rồi dời sang ngày đi thật. Thứ Bảy,
 * để giờ mở cửa theo thứ trong tuần vẫn đúng khi dời sang một thứ Bảy khác.
 */
export const DRAFT_ANCHOR_DATE = '2026-01-03';

const DAY_MS = 24 * 60 * 60 * 1000;
const START_MINUTE = 8 * 60;
const END_MINUTE = 18 * 60;

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

/** Ngày "YYYY-MM-DD" theo giờ Việt Nam của một mốc thời gian. */
export function vietnamDate(at: Date): string {
  return toVietnamLocal(at.toISOString()).date;
}

/** Thứ Bảy kế tiếp theo giờ Việt Nam; hôm nay là thứ Bảy hoặc Chủ nhật thì lấy thứ Bảy tuần sau. */
export function nextSaturday(now: Date): string {
  const today = vietnamDate(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Chủ nhật … 6 = thứ Bảy
  const ahead = weekday === 6 ? 7 : weekday === 0 ? 6 : 6 - weekday;
  return addDays(today, ahead);
}

/** Chuyến `daysCount` ngày bắt đầu `date`: 8:00 ngày đầu → 18:00 ngày cuối. */
export function tripBounds(
  date: string,
  daysCount: number,
): { startsAt: string; endsAt: string } {
  return {
    startsAt: vietnamIso(date, START_MINUTE),
    endsAt: vietnamIso(addDays(date, daysCount - 1), END_MINUTE),
  };
}

function shiftIso(iso: string, days: number): string {
  const { date, minute } = toVietnamLocal(iso);
  return vietnamIso(addDays(date, days), minute);
}

/** Dời toàn bộ ngày giờ của một bản nháp sang ngày đi `toDate`, giữ giờ trong ngày. Không sửa bản gốc. */
export function shiftPlan<
  T extends { input: ItineraryInput; days: ItineraryDay[] },
>(plan: T, toDate: string): T {
  const n = daysBetween(toVietnamLocal(plan.input.startsAt).date, toDate);
  if (n === 0) return plan;
  return {
    ...plan,
    input: {
      ...plan.input,
      startsAt: shiftIso(plan.input.startsAt, n),
      endsAt: shiftIso(plan.input.endsAt, n),
    },
    days: plan.days.map((day) => ({
      ...day,
      date: addDays(day.date, n),
      startsAt: shiftIso(day.startsAt, n),
      endsAt: shiftIso(day.endsAt, n),
      items: day.items.map((item) => ({
        ...item,
        startsAt: shiftIso(item.startsAt, n),
        endsAt: shiftIso(item.endsAt, n),
      })),
    })),
  };
}
