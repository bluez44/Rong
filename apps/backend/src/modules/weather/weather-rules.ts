import type {
  TripWeatherSummary,
  WeatherCondition,
  WeatherDay,
} from '@rong/shared-types';

import { addDays, daysBetween } from '../recommendations/draft-dates.js';

/** Open-Meteo dự báo tối đa 16 ngày, tính cả hôm nay. */
export const FORECAST_HORIZON_DAYS = 16;
/** Khoảng ngày tối đa một lần hỏi (chuyến tối đa 7 ngày nên còn dư). */
export const WEATHER_MAX_RANGE_DAYS = 14;
/** Số năm dữ liệu ERA5 để tính khí hậu theo tháng. */
export const CLIMATE_YEARS = 10;
/** Ngày có lượng mưa từ mức này (mm) trở lên được tính là ngày mưa. */
const RAIN_DAY_MM = 1;

/** Mã thời tiết WMO của Open-Meteo → tình trạng app hiển thị. Tuyết và mã lạ coi như nhiều mây. */
export function conditionFromWmo(code: number): WeatherCondition {
  if (code <= 1) return 'clear';
  if (code === 2) return 'partly_cloudy';
  if (code === 3) return 'cloudy';
  if (code >= 45 && code <= 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code >= 95 && code <= 99) return 'storm';
  return 'cloudy';
}

/** Ngày `date` còn trong tầm dự báo tính từ `today` (cả hai là YYYY-MM-DD giờ Việt Nam). */
export function isForecastDate(date: string, today: string): boolean {
  return daysBetween(today, date) < FORECAST_HORIZON_DAYS;
}

/** Các ngày từ `from` tới `to` (gồm cả hai), bỏ những ngày trước `today`. */
export function tripDates(from: string, to: string, today: string): string[] {
  const dates: string[] = [];
  for (let d = from < today ? today : from; d <= to; d = addDays(d, 1))
    dates.push(d);
  return dates;
}

/** Khối `daily` của `/v1/forecast`. */
export interface ForecastDaily {
  time: string[];
  weather_code: Array<number | null>;
  temperature_2m_max: Array<number | null>;
  temperature_2m_min: Array<number | null>;
  precipitation_probability_max: Array<number | null>;
}

/** Ngày dự báo; ngày thiếu mã thời tiết hay nhiệt độ thì bỏ. */
export function forecastDays(daily: ForecastDaily): WeatherDay[] {
  return daily.time.flatMap((date, i): WeatherDay[] => {
    const code = daily.weather_code[i];
    const max = daily.temperature_2m_max[i];
    const min = daily.temperature_2m_min[i];
    if (code == null || max == null || min == null) return [];
    const chance = daily.precipitation_probability_max[i];
    return [
      {
        date,
        kind: 'forecast',
        condition: conditionFromWmo(code),
        tempMax: Math.round(max),
        tempMin: Math.round(min),
        rainChance: chance == null ? null : Math.round(chance),
      },
    ];
  });
}

/** Khối `daily` của `/v1/archive` (ERA5). */
export interface ArchiveDaily {
  time: string[];
  temperature_2m_max: Array<number | null>;
  temperature_2m_min: Array<number | null>;
  precipitation_sum: Array<number | null>;
}

export interface ClimateMonth {
  /** 1–12. */
  month: number;
  tempMax: number;
  tempMin: number;
  /** Tỉ lệ ngày mưa (≥ 1 mm), 0–1. */
  rainDayRatio: number;
  /** Lượng mưa trung bình cả tháng. */
  precipitationMm: number;
}

/** Khí hậu từng tháng từ dữ liệu ngày; tháng thiếu nhiệt độ hay lượng mưa thì bỏ. */
export function climateFromDaily(daily: ArchiveDaily): ClimateMonth[] {
  const acc = Array.from({ length: 12 }, () => ({
    max: 0,
    min: 0,
    tempDays: 0,
    rainDays: 0,
    precip: 0,
    precipDays: 0,
    yearMonths: new Set<string>(),
  }));
  daily.time.forEach((date, i) => {
    const m = acc[Number(date.slice(5, 7)) - 1];
    const max = daily.temperature_2m_max[i];
    const min = daily.temperature_2m_min[i];
    const precip = daily.precipitation_sum[i];
    if (max != null && min != null) {
      m.max += max;
      m.min += min;
      m.tempDays++;
    }
    if (precip != null) {
      m.precip += precip;
      m.precipDays++;
      if (precip >= RAIN_DAY_MM) m.rainDays++;
      m.yearMonths.add(date.slice(0, 7));
    }
  });
  return acc.flatMap((m, i): ClimateMonth[] =>
    m.tempDays === 0 || m.precipDays === 0
      ? []
      : [
          {
            month: i + 1,
            tempMax: m.max / m.tempDays,
            tempMin: m.min / m.tempDays,
            rainDayRatio: m.rainDays / m.precipDays,
            precipitationMm: m.precip / m.yearMonths.size,
          },
        ],
  );
}

/** Ngày xa ngoài tầm dự báo: dùng khí hậu của tháng. */
export function climateDay(date: string, c: ClimateMonth): WeatherDay {
  return {
    date,
    kind: 'climate',
    condition:
      c.rainDayRatio >= 0.5
        ? 'rain'
        : c.rainDayRatio >= 0.25
          ? 'cloudy'
          : 'clear',
    tempMax: Math.round(c.tempMax),
    tempMin: Math.round(c.tempMin),
    rainChance: Math.round(c.rainDayRatio * 100),
  };
}

/** Từ nhẹ tới nặng; hòa số ngày thì lấy loại nặng hơn. */
const SEVERITY: WeatherCondition[] = [
  'clear',
  'partly_cloudy',
  'cloudy',
  'fog',
  'drizzle',
  'rain',
  'storm',
];

/** Tóm tắt cả chuyến cho thẻ gợi ý: có giông/mưa thì báo loại nặng nhất, không thì loại nhiều ngày nhất. */
export function summarizeDays(days: WeatherDay[]): TripWeatherSummary | null {
  if (days.length === 0) return null;
  let condition: WeatherCondition;
  if (days.some((d) => d.condition === 'storm')) condition = 'storm';
  else if (days.some((d) => d.condition === 'rain')) condition = 'rain';
  else {
    const counts = new Map<WeatherCondition, number>();
    for (const d of days)
      counts.set(d.condition, (counts.get(d.condition) ?? 0) + 1);
    condition = [...counts.entries()].reduce((best, next) =>
      next[1] > best[1] ||
      (next[1] === best[1] &&
        SEVERITY.indexOf(next[0]) > SEVERITY.indexOf(best[0]))
        ? next
        : best,
    )[0];
  }
  const chances = days
    .map((d) => d.rainChance)
    .filter((c): c is number => c !== null);
  const kinds = new Set(days.map((d) => d.kind));
  return {
    kind: kinds.size > 1 ? 'mixed' : days[0].kind,
    condition,
    tempMin: Math.min(...days.map((d) => d.tempMin)),
    tempMax: Math.max(...days.map((d) => d.tempMax)),
    rainChance: chances.length > 0 ? Math.max(...chances) : null,
  };
}

/** Đếm lượt trong ngày (giờ Việt Nam), trong bộ nhớ; sang ngày mới thì đếm lại. */
export class DailyBudget {
  private day = '';
  private used = 0;

  constructor(private readonly limit: number) {}

  take(today: string): boolean {
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }
}
