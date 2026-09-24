/**
 * Đọc chuỗi `opening_hours` của OSM (ví dụ "Mo-Fr 07:00-17:00; Sa,Su 08:00-12:00")
 * để biết giờ mở cửa hôm nay và hiện có đang mở không.
 *
 * Chỉ hiểu phần cú pháp phổ biến: thứ trong tuần (kể cả khoảng vắt qua cuối
 * tuần như Fr-Mo), nhiều khung giờ, giờ qua nửa đêm, "24/7", "off"/"closed".
 * Luật sau ghi đè luật trước cho những ngày nó nhắc tới — đúng ngữ nghĩa OSM.
 * Gặp cú pháp khác (tháng, ngày lễ PH, bình minh…) thì trả về null thay vì
 * đoán sai: "không rõ" tốt hơn "đang mở" nhầm.
 */

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const VIETNAM_UTC_OFFSET_MINUTES = 7 * 60;

/** Các khung giờ theo phút tính từ 0h, mỗi ngày trong tuần (0 = thứ Hai). `end` có thể > 1440 khi mở qua đêm. */
export type WeeklyHours = Array<Array<[number, number]>>;

export interface HoursToday {
  openNow: boolean | null;
  /** "07:00–22:00", "07:00–11:30, 13:30–17:00", "Mở cả ngày", "Đóng cửa hôm nay". */
  today: string | null;
}

export function parseOpeningHours(raw: string): WeeklyHours | null {
  const text = raw.trim();
  if (text === '24/7') return DAYS.map(() => [[0, 1440]]);

  const week: WeeklyHours = DAYS.map(() => []);
  const rules = text
    .split(/;|\|\|/)
    .map((rule) => rule.trim())
    .filter(Boolean);
  if (rules.length === 0) return null;

  for (const rule of rules) {
    const match = /^(?:([A-Za-z]{2}(?:\s*[-,]\s*[A-Za-z]{2})*)\s+)?(.+)$/.exec(
      rule,
    );
    if (!match) return null;
    const [, daysPart, timesPart] = match;

    // Không ghi ngày nghĩa là áp dụng mọi ngày ("07:00-22:00").
    const days =
      daysPart !== undefined ? parseDays(daysPart) : [0, 1, 2, 3, 4, 5, 6];
    if (days === null) return null;

    const times = timesPart.trim();
    let ranges: Array<[number, number]>;
    if (/^(off|closed)$/i.test(times)) {
      ranges = [];
    } else if (times === '24/7' || times === '00:00-24:00') {
      ranges = [[0, 1440]];
    } else {
      const parsed = parseTimes(times);
      if (parsed === null) return null;
      ranges = parsed;
    }
    for (const day of days) week[day] = ranges;
  }
  return week;
}

function parseDays(text: string): number[] | null {
  const result = new Set<number>();
  for (const item of text.split(',').map((s) => s.trim())) {
    const [from, to] = item.split('-').map((s) => s.trim());
    const start = DAYS.indexOf(from as (typeof DAYS)[number]);
    const end =
      to === undefined ? start : DAYS.indexOf(to as (typeof DAYS)[number]);
    if (start < 0 || end < 0) return null;
    for (let d = start; ; d = (d + 1) % 7) {
      result.add(d);
      if (d === end) break;
    }
  }
  return [...result];
}

function parseTimes(text: string): Array<[number, number]> | null {
  const ranges: Array<[number, number]> = [];
  for (const item of text.split(',').map((s) => s.trim())) {
    const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(item);
    if (!match) return null;
    const start = Number(match[1]) * 60 + Number(match[2]);
    let end = Number(match[3]) * 60 + Number(match[4]);
    if (start >= 1440 || end > 1440 * 2) return null;
    if (end <= start) end += 1440; // 18:00-02:00 → mở qua nửa đêm
    ranges.push([start, end]);
  }
  return ranges;
}

const hhmm = (minutes: number): string => {
  const m = minutes % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Giờ hôm nay và trạng thái mở cửa theo giờ Việt Nam (UTC+7, không có giờ mùa hè). */
export function hoursToday(
  raw: string | null,
  now: Date = new Date(),
): HoursToday | null {
  if (!raw) return null;
  const week = parseOpeningHours(raw);
  if (week === null) return { openNow: null, today: null };

  const local = new Date(now.getTime() + VIETNAM_UTC_OFFSET_MINUTES * 60_000);
  const day = (local.getUTCDay() + 6) % 7; // getUTCDay: 0 = Chủ nhật → đổi về 0 = thứ Hai
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const yesterday = week[(day + 6) % 7];

  const openNow =
    week[day].some(([s, e]) => minute >= s && minute < e) ||
    yesterday.some(([, e]) => e > 1440 && minute < e - 1440);

  const ranges = week[day];
  const today =
    ranges.length === 0
      ? 'Đóng cửa hôm nay'
      : ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] >= 1440
        ? 'Mở cả ngày'
        : ranges.map(([s, e]) => `${hhmm(s)}–${hhmm(e)}`).join(', ');

  return { openNow, today };
}
