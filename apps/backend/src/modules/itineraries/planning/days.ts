import type { PartyRules } from './rules.js';

export const VN_OFFSET_MINUTES = 7 * 60;

export interface DayWindow {
  index: number;
  /** YYYY-MM-DD theo giờ Việt Nam. */
  date: string;
  /** 0 = thứ Hai … 6 = Chủ nhật — cùng quy ước với opening-hours.ts. */
  weekday: number;
  start: number;
  end: number;
  isFirst: boolean;
  isLast: boolean;
}

/** Ngày và phút trong ngày theo giờ Việt Nam của một thời điểm. */
export function toVietnamLocal(iso: string): { date: string; minute: number } {
  const local = new Date(new Date(iso).getTime() + VN_OFFSET_MINUTES * 60_000);
  return {
    date: local.toISOString().slice(0, 10),
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** Chuỗi ISO có múi giờ +07:00 cho một phút trong một ngày. */
export function vietnamIso(date: string, minute: number): string {
  const clamped = Math.max(0, Math.min(minute, 24 * 60 - 1));
  const hh = String(Math.floor(clamped / 60)).padStart(2, '0');
  const mm = String(clamped % 60).padStart(2, '0');
  return `${date}T${hh}:${mm}:00+07:00`;
}

/**
 * Chia chuyến đi thành các ngày: ngày đầu bắt đầu từ giờ khởi hành, ngày cuối
 * kết thúc trước giờ về, các ngày giữa theo khung giờ của đối tượng. Ngày chỉ
 * còn dưới 1 tiếng thì bỏ.
 */
export function buildDays(
  startsAt: string,
  endsAt: string,
  rules: PartyRules,
): DayWindow[] {
  const start = toVietnamLocal(startsAt);
  const end = toVietnamLocal(endsAt);
  const days: DayWindow[] = [];

  for (
    let cursor = new Date(`${start.date}T00:00:00Z`);
    cursor.toISOString().slice(0, 10) <= end.date;
    cursor = new Date(cursor.getTime() + 24 * 60 * 60_000)
  ) {
    const date = cursor.toISOString().slice(0, 10);
    const isFirst = date === start.date;
    const isLast = date === end.date;
    const from = isFirst
      ? Math.max(start.minute, rules.dayStart)
      : rules.dayStart;
    const to = isLast ? Math.min(end.minute, rules.dayEnd) : rules.dayEnd;
    if (to - from < 60) continue;
    days.push({
      index: days.length,
      date,
      weekday: (cursor.getUTCDay() + 6) % 7,
      start: from,
      end: to,
      isFirst,
      isLast,
    });
  }
  return days;
}
