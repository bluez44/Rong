# Thời tiết theo ngày của chuyến đi — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hiện thời tiết từng ngày của chuyến (dự báo thật ≤ 16 ngày, khí hậu theo tháng cho ngày xa hơn) ở form tạo lịch trình, chi tiết lịch trình và thẻ gợi ý trang chủ.

**Architecture:** Module backend mới `modules/weather/` là gateway duy nhất tới Open-Meteo: dự báo cache trong bộ nhớ 3 giờ, khí hậu tính một lần mỗi vùng từ 10 năm ERA5 rồi lưu bảng `region_climate`. Endpoint `GET /regions/:id/weather` trả từng ngày kèm `kind`; feed gợi ý điền `weather` bằng `WeatherService.summarizeTrip`. Mobile có một hook và một dải chip dùng chung.

**Tech Stack:** NestJS 12, TypeORM raw SQL, Postgres, vitest + supertest; Expo / React Native, expo-symbols; `@rong/shared-types`.

**Spec:** `docs/superpowers/specs/2026-10-22-trip-weather-design.md`

## Global Constraints

- ESM backend: import tương đối phải có đuôi `.js`.
- Comment, log, thông báo lỗi bằng tiếng Việt.
- Lỗi Nest có body `{ statusCode, code, message }`; mã dùng: `INVALID_DATES` (400), `REGION_NOT_FOUND` (404).
- Chỉ `modules/weather/` gọi Open-Meteo; app mobile không gọi trực tiếp.
- Mốc dự báo: ngày `d` là `forecast` khi `daysBetween(hôm nay giờ VN, d) < 16`, ngược lại `climate`; ngày đã qua bị bỏ.
- Khoảng ngày tối đa của API: 14 ngày (`WEATHER_MAX_RANGE_DAYS`).
- Thời tiết là thông tin phụ: lỗi nguồn → `200 { status: 'unavailable', days: [] }` / `weather: null`, không bao giờ làm hỏng màn hình hay feed.
- `WEATHER_ENABLED` mặc định `true`, riêng `NODE_ENV=test` mặc định `false`; `WEATHER_CLIMATE_DAILY_LIMIT` mặc định 25.
- Ghi nguồn "Dữ liệu thời tiết: Open-Meteo" ở mọi chỗ hiện dải chip hoặc sheet chi tiết.
- Ngày `climate` trên app: viền đứt, màu nhạt, nhiệt độ có `~`, mưa ghi "hay mưa" (≥ 50) / "ít mưa".
- Sau khi sửa `packages/shared-types`, chạy `pnpm --filter @rong/backend build:deps` trước khi gọi `vitest`/`tsc` trực tiếp.
- Commit nhỏ, mỗi task một commit; cuối commit message có hai dòng:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` và
  `Claude-Session: https://claude.ai/code/session_0144WGq2fQ1byzqdA9K6qGhQ`.

## Review Focus

1. **Đổi ngày qua nửa đêm / sang ngày mới:** cache dự báo phải gắn với "hôm nay" — lần gọi đầu ngày mới không được trả dự báo của ngày hôm qua làm hôm nay. (Task 4: cache theo `today`; e2e "ngày đã qua bị bỏ".)
2. **Archive chậm ở lần đầu một vùng:** request không được treo quá ~5 s; khí hậu tiếp tục tính nền và lần sau có. (Task 4: `CLIMATE_WAIT_MS`, test "archive treo vẫn trả dự báo".)
3. **Hai request cùng vùng cùng lúc:** chỉ một lần gọi archive / forecast. (Task 4: test gọi song song, `archive` 1 lần.)
4. **Dữ liệu Open-Meteo có `null`** (ngày cuối dự báo thiếu xác suất mưa, archive thiếu ngày): không ném lỗi, bỏ ngày thiếu nhiệt, `rainChance: null`. (Task 2: test `forecastDays` với null.)
5. **Feed gợi ý khi Open-Meteo chậm:** feed không được chậm hơn ~2,5 s vì thời tiết. (Task 4: `summarizeTrip` có `waitMs`, test với forecast treo.)

---

## File Structure

**Backend (`apps/backend/`)**
- Create `src/modules/weather/weather-rules.ts` — hàm thuần: mã WMO, chia forecast/climate, tổng hợp khí hậu, tóm tắt chuyến, `DailyBudget`.
- Create `src/modules/weather/weather-rules.spec.ts`
- Create `src/modules/weather/open-meteo.client.ts` — HTTP tới Open-Meteo, `WEATHER_CONFIG`.
- Create `src/modules/weather/weather.service.ts` — tọa độ vùng, cache, `region_climate`, `regionWeather`, `summarizeTrip`.
- Create `src/modules/weather/weather.controller.ts`, `src/modules/weather/dto/weather-query.dto.ts`, `src/modules/weather/weather.module.ts`
- Create `src/database/migrations/1792600000000-AddRegionClimate.ts`
- Create `test/weather.e2e-spec.ts`
- Modify `src/config/configuration.ts`, `.env.example`, `src/app.module.ts`
- Modify `src/modules/recommendations/recommendations.service.ts`, `recommendations.module.ts`, `test/recommendations.e2e-spec.ts`
- Modify `src/modules/README.md`

**Shared types (`packages/shared-types/src/`)**
- Create `weather.ts`; modify `index.ts`, `recommendation.ts`

**Mobile (`apps/mobile/src/`)**
- Modify `components/ui/icon.tsx` — icon thời tiết.
- Create `lib/weather.ts` — icon/nhãn/định dạng.
- Create `hooks/use-region-weather.ts`
- Create `components/weather-strip.tsx` — `WeatherStrip`, `WeatherDayChip`.
- Create `components/day-weather-badge.tsx` — badge + sheet cho chi tiết lịch trình.
- Modify `app/(app)/itinerary/new.tsx`, `components/itinerary-view/itinerary-view.tsx`, `app/(app)/itinerary/[id].tsx`, `components/recommendation-card.tsx`

**Docs:** `CLAUDE.md`, `docs/superpowers/specs/2026-10-19-home-recommendations-design.md`

---

### Task 1: Kiểu dùng chung

**Files:**
- Create: `packages/shared-types/src/weather.ts`
- Modify: `packages/shared-types/src/index.ts`, `packages/shared-types/src/recommendation.ts:85-86`
- Modify: `apps/backend/src/modules/recommendations/recommendations.service.ts:330` (chỉ để còn biên dịch)

**Interfaces:**
- Produces: `WeatherCondition`, `WeatherDay`, `RegionWeather`, `TripWeatherSummary`; `RecommendationCard.weather: TripWeatherSummary | null`.

- [ ] **Step 1: Tạo `packages/shared-types/src/weather.ts`**

```ts
/** Thời tiết theo ngày của chuyến (spec 2026-10-22-trip-weather). Nguồn: Open-Meteo. */
export type WeatherCondition = 'clear' | 'partly_cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'storm';

export interface WeatherDay {
  /** YYYY-MM-DD, giờ Việt Nam. */
  date: string;
  /** `forecast`: dự báo thật (≤ 16 ngày tới); `climate`: thường gặp của tháng, không phải dự báo. */
  kind: 'forecast' | 'climate';
  condition: WeatherCondition;
  /** °C, đã làm tròn. */
  tempMax: number;
  tempMin: number;
  /** forecast: % khả năng mưa; climate: % số ngày mưa trong tháng. */
  rainChance: number | null;
}

export interface RegionWeather {
  regionId: string;
  status: 'ready' | 'unavailable';
  days: WeatherDay[];
  attribution: 'Open-Meteo.com';
}

/** Tóm tắt cả chuyến, cho thẻ gợi ý. */
export interface TripWeatherSummary {
  kind: 'forecast' | 'climate' | 'mixed';
  condition: WeatherCondition;
  tempMin: number;
  tempMax: number;
  rainChance: number | null;
}
```

- [ ] **Step 2: Xuất ra và đổi kiểu `weather` của thẻ**

`index.ts` thêm dòng cuối:

```ts
export * from './weather';
```

`recommendation.ts`: thêm import ở đầu file và thay hai dòng `weather`:

```ts
import type { TripWeatherSummary } from './weather';
```

```ts
  /** Tóm tắt thời tiết cả chuyến; null khi chưa có dữ liệu (app hiện "Đang cập nhật"). */
  weather: TripWeatherSummary | null;
```

(Nếu `recommendation.ts` đã có khối import khác, gộp vào cùng chỗ.)

- [ ] **Step 3: Build và typecheck**

Run: `pnpm --filter @rong/shared-types build && pnpm --filter @rong/backend typecheck && pnpm --filter @rong/mobile typecheck`
Expected: PASS (`weather: null` vẫn hợp lệ với kiểu mới).

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src
git commit -m "feat(shared-types): weather types for trip forecasts"
```

---

### Task 2: Quy tắc thời tiết (hàm thuần)

**Files:**
- Create: `apps/backend/src/modules/weather/weather-rules.ts`
- Test: `apps/backend/src/modules/weather/weather-rules.spec.ts`

**Interfaces:**
- Consumes: `addDays(date, n)`, `daysBetween(from, to)` từ `src/modules/recommendations/draft-dates.ts`.
- Produces:
  - `FORECAST_HORIZON_DAYS = 16`, `WEATHER_MAX_RANGE_DAYS = 14`, `CLIMATE_YEARS = 10`
  - `conditionFromWmo(code: number): WeatherCondition`
  - `isForecastDate(date: string, today: string): boolean`
  - `tripDates(from: string, to: string, today: string): string[]`
  - `interface ForecastDaily`, `forecastDays(daily: ForecastDaily): WeatherDay[]`
  - `interface ArchiveDaily`, `interface ClimateMonth { month; tempMax; tempMin; rainDayRatio; precipitationMm }`, `climateFromDaily(daily: ArchiveDaily): ClimateMonth[]`
  - `climateDay(date: string, c: ClimateMonth): WeatherDay`
  - `summarizeDays(days: WeatherDay[]): TripWeatherSummary | null`
  - `class DailyBudget { constructor(limit: number); take(today: string): boolean }`

- [ ] **Step 1: Viết test**

```ts
import type { WeatherDay } from '@rong/shared-types';
import { describe, expect, it } from 'vitest';

import {
  climateDay,
  climateFromDaily,
  conditionFromWmo,
  DailyBudget,
  forecastDays,
  isForecastDate,
  summarizeDays,
  tripDates,
} from './weather-rules.js';

describe('conditionFromWmo', () => {
  it.each([
    [0, 'clear'], [1, 'clear'], [2, 'partly_cloudy'], [3, 'cloudy'], [45, 'fog'], [48, 'fog'],
    [51, 'drizzle'], [57, 'drizzle'], [61, 'rain'], [67, 'rain'], [80, 'rain'], [82, 'rain'],
    [95, 'storm'], [99, 'storm'], [71, 'cloudy'], [86, 'cloudy'],
  ])('%i → %s', (code, expected) => {
    expect(conditionFromWmo(code)).toBe(expected);
  });
});

describe('isForecastDate / tripDates', () => {
  it('16 ngày tính cả hôm nay là dự báo, ngày thứ 17 là khí hậu', () => {
    expect(isForecastDate('2026-10-22', '2026-10-22')).toBe(true);
    expect(isForecastDate('2026-11-06', '2026-10-22')).toBe(true); // +15
    expect(isForecastDate('2026-11-07', '2026-10-22')).toBe(false); // +16
  });

  it('bỏ ngày đã qua, gồm cả hai đầu', () => {
    expect(tripDates('2026-10-20', '2026-10-23', '2026-10-22')).toEqual(['2026-10-22', '2026-10-23']);
    expect(tripDates('2026-10-25', '2026-10-25', '2026-10-22')).toEqual(['2026-10-25']);
    expect(tripDates('2026-10-18', '2026-10-20', '2026-10-22')).toEqual([]);
  });
});

describe('forecastDays', () => {
  it('làm tròn, giữ null của xác suất mưa, bỏ ngày thiếu nhiệt độ', () => {
    expect(
      forecastDays({
        time: ['2026-10-22', '2026-10-23', '2026-10-24'],
        weather_code: [61, 2, null],
        temperature_2m_max: [30.4, 29.6, 28],
        temperature_2m_min: [22.6, null, 21],
        precipitation_probability_max: [70, 10, null],
      }),
    ).toEqual([{ date: '2026-10-22', kind: 'forecast', condition: 'rain', tempMax: 30, tempMin: 23, rainChance: 70 }]);
    expect(
      forecastDays({
        time: ['2026-10-22'],
        weather_code: [1],
        temperature_2m_max: [31],
        temperature_2m_min: [24],
        precipitation_probability_max: [null],
      })[0].rainChance,
    ).toBeNull();
  });
});

describe('climateFromDaily / climateDay', () => {
  it('trung bình theo tháng, tỉ lệ ngày mưa ≥ 1 mm, lượng mưa trung bình mỗi tháng', () => {
    const months = climateFromDaily({
      // Hai năm tháng 1: mỗi năm 2 ngày, một ngày mưa 4 mm.
      time: ['2024-01-01', '2024-01-02', '2025-01-01', '2025-01-02', '2025-02-01'],
      temperature_2m_max: [20, 22, 24, 26, null],
      temperature_2m_min: [10, 12, 14, 16, null],
      precipitation_sum: [4, 0.5, 4, 0, 0],
    });
    expect(months).toEqual([
      { month: 1, tempMax: 23, tempMin: 13, rainDayRatio: 0.5, precipitationMm: 4.25 },
    ]);
  });

  it('khí hậu → ngày: mưa ≥ 50%, mây ≥ 25%, còn lại nắng', () => {
    const base = { month: 6, tempMax: 31.6, tempMin: 24.4, precipitationMm: 200 };
    expect(climateDay('2027-06-01', { ...base, rainDayRatio: 0.6 })).toEqual({
      date: '2027-06-01', kind: 'climate', condition: 'rain', tempMax: 32, tempMin: 24, rainChance: 60,
    });
    expect(climateDay('2027-06-01', { ...base, rainDayRatio: 0.3 }).condition).toBe('cloudy');
    expect(climateDay('2027-06-01', { ...base, rainDayRatio: 0.1 }).condition).toBe('clear');
  });
});

describe('summarizeDays', () => {
  const day = (over: Partial<WeatherDay>): WeatherDay => ({
    date: '2026-10-22', kind: 'forecast', condition: 'clear', tempMax: 30, tempMin: 22, rainChance: 10, ...over,
  });

  it('rỗng → null', () => {
    expect(summarizeDays([])).toBeNull();
  });

  it('có ngày mưa thì lấy mưa; có giông thì lấy giông', () => {
    expect(summarizeDays([day({}), day({}), day({ condition: 'rain' })])?.condition).toBe('rain');
    expect(summarizeDays([day({ condition: 'rain' }), day({ condition: 'storm' })])?.condition).toBe('storm');
  });

  it('không mưa thì lấy loại nhiều nhất; hòa thì lấy loại nặng hơn', () => {
    expect(summarizeDays([day({ condition: 'cloudy' }), day({ condition: 'cloudy' }), day({})])?.condition).toBe('cloudy');
    expect(summarizeDays([day({ condition: 'partly_cloudy' }), day({})])?.condition).toBe('partly_cloudy');
  });

  it('min/max nhiệt, mưa lớn nhất, mixed khi có cả hai loại', () => {
    expect(
      summarizeDays([
        day({ tempMax: 31, tempMin: 23, rainChance: null }),
        day({ kind: 'climate', tempMax: 28, tempMin: 19, rainChance: 40 }),
      ]),
    ).toEqual({ kind: 'mixed', condition: 'clear', tempMin: 19, tempMax: 31, rainChance: 40 });
    expect(summarizeDays([day({ rainChance: null })])?.rainChance).toBeNull();
    expect(summarizeDays([day({ kind: 'climate' })])?.kind).toBe('climate');
  });
});

describe('DailyBudget', () => {
  it('hết lượt trong ngày thì từ chối, sang ngày mới thì đếm lại', () => {
    const budget = new DailyBudget(2);
    expect(budget.take('2026-10-22')).toBe(true);
    expect(budget.take('2026-10-22')).toBe(true);
    expect(budget.take('2026-10-22')).toBe(false);
    expect(budget.take('2026-10-23')).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy test, phải fail**

Run: `cd apps/backend && npx vitest run src/modules/weather/weather-rules.spec.ts`
Expected: FAIL — không tìm thấy `./weather-rules.js`.

- [ ] **Step 3: Viết `weather-rules.ts`**

```ts
import type { TripWeatherSummary, WeatherCondition, WeatherDay } from '@rong/shared-types';

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
  for (let d = from < today ? today : from; d <= to; d = addDays(d, 1)) dates.push(d);
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
    condition: c.rainDayRatio >= 0.5 ? 'rain' : c.rainDayRatio >= 0.25 ? 'cloudy' : 'clear',
    tempMax: Math.round(c.tempMax),
    tempMin: Math.round(c.tempMin),
    rainChance: Math.round(c.rainDayRatio * 100),
  };
}

/** Từ nhẹ tới nặng; hòa số ngày thì lấy loại nặng hơn. */
const SEVERITY: WeatherCondition[] = ['clear', 'partly_cloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'storm'];

/** Tóm tắt cả chuyến cho thẻ gợi ý: có giông/mưa thì báo loại nặng nhất, không thì loại nhiều ngày nhất. */
export function summarizeDays(days: WeatherDay[]): TripWeatherSummary | null {
  if (days.length === 0) return null;
  let condition: WeatherCondition;
  if (days.some((d) => d.condition === 'storm')) condition = 'storm';
  else if (days.some((d) => d.condition === 'rain')) condition = 'rain';
  else {
    const counts = new Map<WeatherCondition, number>();
    for (const d of days) counts.set(d.condition, (counts.get(d.condition) ?? 0) + 1);
    condition = [...counts.entries()].reduce((best, next) =>
      next[1] > best[1] || (next[1] === best[1] && SEVERITY.indexOf(next[0]) > SEVERITY.indexOf(best[0]))
        ? next
        : best,
    )[0];
  }
  const chances = days.map((d) => d.rainChance).filter((c): c is number => c !== null);
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
```

- [ ] **Step 4: Chạy test, phải pass**

Run: `cd apps/backend && npx vitest run src/modules/weather/weather-rules.spec.ts`
Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/weather/weather-rules.ts apps/backend/src/modules/weather/weather-rules.spec.ts
git commit -m "feat(backend): weather rules for forecast and monthly climate"
```

---

### Task 3: Cấu hình, migration `region_climate`, client Open-Meteo

**Files:**
- Modify: `apps/backend/src/config/configuration.ts` (thêm `WeatherConfig`, khóa `weather` trong `AppConfig` và `loadConfig`)
- Modify: `apps/backend/.env.example`
- Create: `apps/backend/src/database/migrations/1792600000000-AddRegionClimate.ts`
- Create: `apps/backend/src/modules/weather/open-meteo.client.ts`

**Interfaces:**
- Consumes: `ThrottledHttp` (`src/modules/open-data/http.ts`), `ForecastDaily`, `ArchiveDaily` (Task 2).
- Produces:
  - `interface WeatherConfig { enabled: boolean; forecastUrl: string; archiveUrl: string; contactEmail: string; climateDailyLimit: number }`
  - `WEATHER_CONFIG = 'WEATHER_CONFIG'`
  - `class OpenMeteoClient { forecast(lat: number, lng: number): Promise<ForecastDaily>; archive(lat: number, lng: number, from: string, to: string): Promise<ArchiveDaily> }`
  - Bảng `region_climate (region_id, month, temp_max, temp_min, rain_day_ratio, precipitation_mm, computed_at)`.

- [ ] **Step 1: Cấu hình**

Thêm interface cạnh `RecommendationsConfig`:

```ts
/** Thời tiết theo ngày của chuyến (spec 2026-10-22-trip-weather). Chỉ module `weather/` gọi Open-Meteo. */
export interface WeatherConfig {
  /** Tắt thì endpoint trả `unavailable`, thẻ gợi ý `weather: null`. Mặc định tắt khi NODE_ENV=test (e2e không gọi mạng). */
  enabled: boolean;
  forecastUrl: string;
  archiveUrl: string;
  /** User-Agent có thông tin liên hệ, như Nominatim. */
  contactEmail: string;
  /** Số vùng tính khí hậu mới mỗi ngày (mỗi vùng ~260 lượt của bản miễn phí). */
  climateDailyLimit: number;
}
```

Thêm `weather: WeatherConfig;` vào `AppConfig` (sau `admin`), và trong object trả về của `loadConfig` (sau `admin: {...}`):

```ts
    weather: {
      enabled: process.env.WEATHER_ENABLED
        ? process.env.WEATHER_ENABLED !== 'false'
        : process.env.NODE_ENV !== 'test',
      forecastUrl: process.env.OPEN_METEO_FORECAST_URL || 'https://api.open-meteo.com',
      archiveUrl: process.env.OPEN_METEO_ARCHIVE_URL || 'https://archive-api.open-meteo.com',
      contactEmail: process.env.OPEN_DATA_CONTACT_EMAIL || 'dev@rong.local',
      climateDailyLimit: positiveInt('WEATHER_CLIMATE_DAILY_LIMIT', 25),
    },
```

`.env.example`, cạnh `RECOMMENDATIONS_ENABLED`:

```bash
# Thời tiết theo ngày (Open-Meteo, không cần key). Mặc định bật; e2e (NODE_ENV=test) mặc định tắt.
# WEATHER_ENABLED=true
# WEATHER_CLIMATE_DAILY_LIMIT=25
```

- [ ] **Step 2: Migration**

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Khí hậu theo tháng của từng vùng (spec 2026-10-22-trip-weather): tính một lần từ 10 năm ERA5 của Open-Meteo,
 * dùng cho ngày của chuyến nằm ngoài tầm dự báo 16 ngày.
 */
export class AddRegionClimate1792600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "region_climate" (
        "region_id" uuid NOT NULL REFERENCES "regions" ("id") ON DELETE CASCADE,
        "month" smallint NOT NULL,
        "temp_max" real NOT NULL,
        "temp_min" real NOT NULL,
        "rain_day_ratio" real NOT NULL,
        "precipitation_mm" real NOT NULL,
        "computed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_region_climate" PRIMARY KEY ("region_id", "month"),
        CONSTRAINT "chk_region_climate_month" CHECK ("month" BETWEEN 1 AND 12),
        CONSTRAINT "chk_region_climate_ratio" CHECK ("rain_day_ratio" BETWEEN 0 AND 1)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "region_climate"`);
  }
}
```

- [ ] **Step 3: Client**

```ts
import { Inject, Injectable } from '@nestjs/common';

import type { WeatherConfig } from '../../config/configuration.js';
import { ThrottledHttp } from '../open-data/http.js';
import type { ArchiveDaily, ForecastDaily } from './weather-rules.js';

export const WEATHER_CONFIG = 'WEATHER_CONFIG';

const TIMEZONE = 'Asia/Ho_Chi_Minh';
const FORECAST_TIMEOUT_MS = 5000;
/** 10 năm dữ liệu ngày: phản hồi lớn, chờ lâu hơn (request người dùng chỉ đợi `CLIMATE_WAIT_MS`). */
const ARCHIVE_TIMEOUT_MS = 30_000;

/** Gọi HTTP tới Open-Meteo. Tách khỏi `WeatherService` để e2e thay bằng bản giả. */
@Injectable()
export class OpenMeteoClient {
  private readonly http: ThrottledHttp;

  constructor(@Inject(WEATHER_CONFIG) private readonly config: WeatherConfig) {
    // Bản miễn phí cho 600 lượt/phút: không cần giãn cách giữa các request.
    this.http = new ThrottledHttp(`Rong/0.1 (${config.contactEmail})`, {});
  }

  /** Dự báo 16 ngày, tính từ hôm nay (giờ Việt Nam). */
  async forecast(lat: number, lng: number): Promise<ForecastDaily> {
    const url = new URL('/v1/forecast', this.config.forecastUrl);
    url.search = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: TIMEZONE,
      forecast_days: '16',
    }).toString();
    const body = await this.http.getJson<{ daily: ForecastDaily }>(url.toString(), {}, FORECAST_TIMEOUT_MS);
    return body.daily;
  }

  /** Dữ liệu ngày ERA5 từ `from` tới `to` (YYYY-MM-DD). */
  async archive(lat: number, lng: number, from: string, to: string): Promise<ArchiveDaily> {
    const url = new URL('/v1/archive', this.config.archiveUrl);
    url.search = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      start_date: from,
      end_date: to,
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
      timezone: TIMEZONE,
    }).toString();
    const body = await this.http.getJson<{ daily: ArchiveDaily }>(url.toString(), {}, ARCHIVE_TIMEOUT_MS);
    return body.daily;
  }
}
```

- [ ] **Step 4: Typecheck, lint, chạy migration**

Run: `cd apps/backend && pnpm typecheck && pnpm lint`
Expected: PASS.

Hỏi người dùng trước khi chạy `pnpm migration:run` (`.env` trỏ vào DB dev/test trên Neon). Được đồng ý thì chạy:
Run: `cd apps/backend && pnpm migration:run`
Expected: log `AddRegionClimate1792600000000 has been executed successfully.`

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/config/configuration.ts apps/backend/.env.example apps/backend/src/database/migrations/1792600000000-AddRegionClimate.ts apps/backend/src/modules/weather/open-meteo.client.ts
git commit -m "feat(backend): weather config, region_climate table and Open-Meteo client"
```

---

### Task 4: `WeatherService`, endpoint và e2e

**Files:**
- Create: `apps/backend/src/modules/weather/weather.service.ts`
- Create: `apps/backend/src/modules/weather/dto/weather-query.dto.ts`
- Create: `apps/backend/src/modules/weather/weather.controller.ts`
- Create: `apps/backend/src/modules/weather/weather.module.ts`
- Modify: `apps/backend/src/app.module.ts` (thêm `WeatherModule` vào `imports`)
- Test: `apps/backend/test/weather.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 2 (mọi hàm trong `weather-rules.ts`), Task 3 (`OpenMeteoClient`, `WEATHER_CONFIG`, `WeatherConfig`, bảng `region_climate`), `RegionAreaService.ensure(regionId): Promise<Bbox>` (`[nam, tây, bắc, đông]`), `vietnamDate(at: Date)`, `daysBetween` từ `draft-dates.ts`.
- Produces:
  - `WeatherService.regionWeather(regionId: string, from: string, to: string, now?: Date): Promise<RegionWeather>`
  - `WeatherService.summarizeTrip(regionId: string, startsAt: string, endsAt: string, waitMs?: number): Promise<TripWeatherSummary | null>` — `startsAt`/`endsAt` là ISO timestamp.
  - `WeatherModule` export `WeatherService`.
  - `GET /api/regions/:id/weather?from=YYYY-MM-DD&to=YYYY-MM-DD` → `RegionWeather`.

- [ ] **Step 1: Viết e2e (fail)**

`apps/backend/test/weather.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { addDays, vietnamDate } from '../src/modules/recommendations/draft-dates.js';
import { OpenMeteoClient, WEATHER_CONFIG } from '../src/modules/weather/open-meteo.client.js';
import type { ArchiveDaily, ForecastDaily } from '../src/modules/weather/weather-rules.js';
import { WeatherService } from '../src/modules/weather/weather.service.js';

describe('Thời tiết theo ngày (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let token: string;
  let seq = 0;
  const forecast = vi.fn<(lat: number, lng: number) => Promise<ForecastDaily>>();
  const archive = vi.fn<(lat: number, lng: number, from: string, to: string) => Promise<ArchiveDaily>>();
  const today = vietnamDate(new Date());

  /** 16 ngày từ hôm nay: mưa, 30°/23°, 70%. */
  const fakeForecast = async (): Promise<ForecastDaily> => {
    const time = Array.from({ length: 16 }, (_, i) => addDays(today, i));
    return {
      time,
      weather_code: time.map(() => 61),
      temperature_2m_max: time.map(() => 30.4),
      temperature_2m_min: time.map(() => 22.6),
      precipitation_probability_max: time.map(() => 70),
    };
  };
  /** Mỗi ngày 28°/20°; tháng 6–10 ngày nào cũng mưa 5 mm, các tháng khác khô. */
  const fakeArchive = async (_lat: number, _lng: number, from: string, to: string): Promise<ArchiveDaily> => {
    const time: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) time.push(d);
    return {
      time,
      temperature_2m_max: time.map(() => 28),
      temperature_2m_min: time.map(() => 20),
      precipitation_sum: time.map((d) => (Number(d.slice(5, 7)) >= 6 && Number(d.slice(5, 7)) <= 10 ? 5 : 0)),
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OpenMeteoClient)
      .useValue({ forecast, archive })
      .overrideProvider(WEATHER_CONFIG)
      .useValue({ enabled: true, forecastUrl: '', archiveUrl: '', contactEmail: 'e2e@rong.local', climateDailyLimit: 25 })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    db = app.get(DataSource);
    const [user] = (await db.query(
      `INSERT INTO users (display_name) VALUES ('e2e-weather') RETURNING id`,
    )) as Array<{ id: string }>;
    token = app.get(JwtService).sign({ sub: user.id });
  });

  beforeEach(() => {
    forecast.mockReset().mockImplementation(fakeForecast);
    archive.mockReset().mockImplementation(fakeArchive);
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM regions WHERE source_key LIKE 'e2e:weather:%'`);
    await db?.query(`DELETE FROM users WHERE display_name = 'e2e-weather'`);
    await app?.close();
  });

  /** Mỗi test một vùng riêng để cache dự báo của test trước không lẫn vào. */
  const newRegion = async (): Promise<string> => {
    const [row] = (await db.query(
      `INSERT INTO regions (source_key, name, type, boundary_version, search_name, bbox_south, bbox_west, bbox_north, bbox_east)
       VALUES ($1, 'Vùng e2e thời tiết', 'destination', 'current', 'vung e2e thoi tiet', 11.85, 108.35, 12.05, 108.55)
       RETURNING id`,
      [`e2e:weather:${Date.now()}:${++seq}`],
    )) as Array<{ id: string }>;
    return row.id;
  };

  const get = (path: string) =>
    request(app.getHttpServer()).get(`/api${path}`).set('Authorization', `Bearer ${token}`);

  it('khoảng ngày vắt qua mốc 16 ngày: 3 ngày dự báo rồi 3 ngày khí hậu', async () => {
    const id = await newRegion();
    const from = addDays(today, 13);
    const to = addDays(today, 18);
    const res = await get(`/regions/${id}/weather?from=${from}&to=${to}`).expect(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.attribution).toBe('Open-Meteo.com');
    expect(res.body.days.map((d: { kind: string }) => d.kind)).toEqual([
      'forecast', 'forecast', 'forecast', 'climate', 'climate', 'climate',
    ]);
    expect(res.body.days[0]).toEqual({
      date: from, kind: 'forecast', condition: 'rain', tempMax: 30, tempMin: 23, rainChance: 70,
    });
    const far = res.body.days[3];
    const wet = Number(far.date.slice(5, 7)) >= 6 && Number(far.date.slice(5, 7)) <= 10;
    expect(far).toEqual({
      date: addDays(today, 16), kind: 'climate', condition: wet ? 'rain' : 'clear',
      tempMax: 28, tempMin: 20, rainChance: wet ? 100 : 0,
    });
    // Tâm bbox của vùng.
    expect(forecast).toHaveBeenCalledWith(11.95, 108.45);
  });

  it('khí hậu chỉ tính một lần, kể cả hai request song song; lần sau đọc region_climate', async () => {
    const id = await newRegion();
    const from = addDays(today, 30);
    const to = addDays(today, 31);
    await Promise.all([
      get(`/regions/${id}/weather?from=${from}&to=${to}`).expect(200),
      get(`/regions/${id}/weather?from=${from}&to=${to}`).expect(200),
    ]);
    const again = await get(`/regions/${id}/weather?from=${from}&to=${to}`).expect(200);
    expect(again.body.days).toHaveLength(2);
    expect(archive).toHaveBeenCalledTimes(1);
    expect(forecast).not.toHaveBeenCalled();
    const [{ count }] = (await db.query(
      `SELECT count(*)::int AS count FROM region_climate WHERE region_id = $1`,
      [id],
    )) as Array<{ count: number }>;
    expect(count).toBe(12);
  });

  it('dự báo song song chỉ gọi Open-Meteo một lần', async () => {
    const id = await newRegion();
    const q = `from=${today}&to=${addDays(today, 1)}`;
    await Promise.all([get(`/regions/${id}/weather?${q}`).expect(200), get(`/regions/${id}/weather?${q}`).expect(200)]);
    await get(`/regions/${id}/weather?${q}`).expect(200);
    expect(forecast).toHaveBeenCalledTimes(1);
  });

  it('archive treo vẫn trả các ngày dự báo trong vài giây', async () => {
    const id = await newRegion();
    archive.mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    const res = await get(`/regions/${id}/weather?from=${addDays(today, 14)}&to=${addDays(today, 17)}`).expect(200);
    expect(Date.now() - started).toBeLessThan(8000);
    expect(res.body.status).toBe('ready');
    expect(res.body.days.map((d: { kind: string }) => d.kind)).toEqual(['forecast', 'forecast']);
  }, 15_000);

  it('Open-Meteo lỗi → 200 unavailable, không có ngày nào', async () => {
    const id = await newRegion();
    forecast.mockRejectedValue(new Error('down'));
    const res = await get(`/regions/${id}/weather?from=${today}&to=${addDays(today, 1)}`).expect(200);
    expect(res.body).toMatchObject({ status: 'unavailable', days: [] });
  });

  it('bỏ ngày đã qua', async () => {
    const id = await newRegion();
    const res = await get(`/regions/${id}/weather?from=${addDays(today, -3)}&to=${addDays(today, 1)}`).expect(200);
    expect(res.body.days.map((d: { date: string }) => d.date)).toEqual([today, addDays(today, 1)]);
  });

  it('ngày sai → 400 (INVALID_DATES khi đảo ngược hoặc quá 14 ngày)', async () => {
    const id = await newRegion();
    const reversed = await get(`/regions/${id}/weather?from=${addDays(today, 2)}&to=${today}`).expect(400);
    expect(reversed.body.code).toBe('INVALID_DATES');
    const tooLong = await get(`/regions/${id}/weather?from=${today}&to=${addDays(today, 14)}`).expect(400);
    expect(tooLong.body.code).toBe('INVALID_DATES');
    await get(`/regions/${id}/weather?from=abc&to=${today}`).expect(400);
  });

  it('vùng không có → 404 REGION_NOT_FOUND; chưa đăng nhập → 401', async () => {
    const res = await get(`/regions/00000000-0000-4000-8000-000000000000/weather?from=${today}&to=${today}`).expect(404);
    expect(res.body.code).toBe('REGION_NOT_FOUND');
    await request(app.getHttpServer()).get(`/api/regions/${await newRegion()}/weather?from=${today}&to=${today}`).expect(401);
  });

  it('summarizeTrip: tóm tắt cả chuyến; dự báo treo thì null sau waitMs', async () => {
    const weather = app.get(WeatherService);
    const id = await newRegion();
    const startsAt = new Date(`${addDays(today, 2)}T08:00:00+07:00`).toISOString();
    const endsAt = new Date(`${addDays(today, 3)}T18:00:00+07:00`).toISOString();
    expect(await weather.summarizeTrip(id, startsAt, endsAt)).toEqual({
      kind: 'forecast', condition: 'rain', tempMin: 23, tempMax: 30, rainChance: 70,
    });

    const slow = await newRegion();
    forecast.mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    expect(await weather.summarizeTrip(slow, startsAt, endsAt, 200)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
```

Run: `cd apps/backend && pnpm build:deps && npx vitest run --config vitest.config.e2e.ts test/weather.e2e-spec.ts`
Expected: FAIL — không tìm thấy `weather.service.js`.

- [ ] **Step 2: DTO**

`dto/weather-query.dto.ts`:

```ts
import { Matches } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class WeatherQueryDto {
  @Matches(DAY, { message: 'from phải có dạng YYYY-MM-DD' })
  from!: string;

  @Matches(DAY, { message: 'to phải có dạng YYYY-MM-DD' })
  to!: string;
}
```

- [ ] **Step 3: Service**

`weather.service.ts`:

```ts
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { RegionWeather, TripWeatherSummary, WeatherDay } from '@rong/shared-types';
import type { DataSource } from 'typeorm';

import type { WeatherConfig } from '../../config/configuration.js';
import { daysBetween, vietnamDate } from '../recommendations/draft-dates.js';
import type { Bbox } from '../regions/bbox.js';
import { RegionAreaService } from '../regions/region-area.service.js';
import { OpenMeteoClient, WEATHER_CONFIG } from './open-meteo.client.js';
import {
  CLIMATE_YEARS,
  climateDay,
  climateFromDaily,
  type ClimateMonth,
  DailyBudget,
  forecastDays,
  isForecastDate,
  summarizeDays,
  tripDates,
  WEATHER_MAX_RANGE_DAYS,
} from './weather-rules.js';

const FORECAST_TTL_MS = 3 * 60 * 60 * 1000;
/** Lần đầu một vùng cần khí hậu: request chỉ chờ chừng này, phần còn lại tính nền. */
const CLIMATE_WAIT_MS = 5000;
/** Feed gợi ý không chờ thời tiết lâu hơn chừng này. */
const SUMMARY_WAIT_MS = 2500;

type Point = { lat: number; lng: number };

/**
 * Thời tiết theo ngày của một vùng: dự báo Open-Meteo cho 16 ngày tới (cache 3 giờ trong bộ nhớ), khí hậu theo
 * tháng cho ngày xa hơn (tính một lần từ 10 năm ERA5, lưu `region_climate`). Lỗi nguồn không bao giờ ném ra ngoài:
 * ngày không có dữ liệu thì bỏ, không còn ngày nào thì `unavailable`.
 */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly forecasts = new Map<string, { today: string; at: number; days: Map<string, WeatherDay> }>();
  private readonly forecastInFlight = new Map<string, Promise<Map<string, WeatherDay> | null>>();
  private readonly climateInFlight = new Map<string, Promise<ClimateMonth[] | null>>();
  private readonly climateBudget: DailyBudget;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(WEATHER_CONFIG) private readonly config: WeatherConfig,
    private readonly client: OpenMeteoClient,
    private readonly areas: RegionAreaService,
  ) {
    this.climateBudget = new DailyBudget(config.climateDailyLimit);
  }

  async regionWeather(regionId: string, from: string, to: string, now = new Date()): Promise<RegionWeather> {
    const span = daysBetween(from, to);
    if (!(span >= 0 && span < WEATHER_MAX_RANGE_DAYS)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_DATES',
        message: `Ngày về phải từ ngày đi trở đi, tối đa ${WEATHER_MAX_RANGE_DAYS} ngày.`,
      });
    }
    const point = await this.regionPoint(regionId);
    const base: RegionWeather = { regionId, status: 'ready', days: [], attribution: 'Open-Meteo.com' };
    if (!this.config.enabled) return { ...base, status: 'unavailable' };

    const today = vietnamDate(now);
    const dates = tripDates(from, to, today);
    if (dates.length === 0) return base;
    const needForecast = dates.some((d) => isForecastDate(d, today));
    const needClimate = dates.some((d) => !isForecastDate(d, today));
    const [forecast, climate] = await Promise.all([
      needForecast ? this.forecast(regionId, point, today, now.getTime()) : null,
      needClimate ? withTimeout(this.climate(regionId, point, today), CLIMATE_WAIT_MS) : null,
    ]);

    const days = dates.flatMap((date): WeatherDay[] => {
      if (isForecastDate(date, today)) {
        const day = forecast?.get(date);
        return day ? [day] : [];
      }
      const month = climate?.find((c) => c.month === Number(date.slice(5, 7)));
      return month ? [climateDay(date, month)] : [];
    });
    return { ...base, days, status: days.length > 0 ? 'ready' : 'unavailable' };
  }

  /** Tóm tắt cả chuyến cho thẻ gợi ý; lỗi hay quá `waitMs` thì null. */
  async summarizeTrip(
    regionId: string,
    startsAt: string,
    endsAt: string,
    waitMs = SUMMARY_WAIT_MS,
  ): Promise<TripWeatherSummary | null> {
    const from = vietnamDate(new Date(startsAt));
    const to = vietnamDate(new Date(endsAt));
    const weather = await withTimeout(
      this.regionWeather(regionId, from, to).catch((error: unknown) => {
        this.logger.warn(`Không lấy được thời tiết cho thẻ gợi ý (${regionId}): ${(error as Error).message}`);
        return null;
      }),
      waitMs,
    );
    return weather ? summarizeDays(weather.days) : null;
  }

  /** Tâm bbox của vùng; chưa có bbox thì tâm vùng, cuối cùng nhờ RegionAreaService tính bbox. */
  private async regionPoint(regionId: string): Promise<Point> {
    const [row] = (await this.db.query(
      `SELECT CASE WHEN bbox_south IS NULL THEN NULL
                   ELSE ARRAY[bbox_south, bbox_west, bbox_north, bbox_east] END AS bbox,
              ST_Y(center) AS lat, ST_X(center) AS lng
         FROM regions WHERE id = $1`,
      [regionId],
    )) as Array<{ bbox: Bbox | null; lat: number | null; lng: number | null }>;
    if (!row) {
      throw new NotFoundException({ statusCode: 404, code: 'REGION_NOT_FOUND', message: 'Không tìm thấy vùng này.' });
    }
    if (row.bbox) return bboxCenter(row.bbox);
    if (row.lat !== null && row.lng !== null) return { lat: row.lat, lng: row.lng };
    return bboxCenter(await this.areas.ensure(regionId));
  }

  /** Dự báo 16 ngày của vùng, cache theo (vùng, hôm nay) 3 giờ; lỗi thì null. */
  private forecast(regionId: string, point: Point, today: string, nowMs: number): Promise<Map<string, WeatherDay> | null> {
    const cached = this.forecasts.get(regionId);
    if (cached && cached.today === today && nowMs - cached.at < FORECAST_TTL_MS) return Promise.resolve(cached.days);
    let pending = this.forecastInFlight.get(regionId);
    if (!pending) {
      pending = this.client
        .forecast(point.lat, point.lng)
        .then((daily) => {
          const days = new Map(forecastDays(daily).map((d) => [d.date, d]));
          this.forecasts.set(regionId, { today, at: nowMs, days });
          return days;
        })
        .catch((error: unknown) => {
          this.logger.warn(`Không lấy được dự báo Open-Meteo (${regionId}): ${(error as Error).message}`);
          return null;
        })
        .finally(() => this.forecastInFlight.delete(regionId));
      this.forecastInFlight.set(regionId, pending);
    }
    return pending;
  }

  /** Khí hậu theo tháng; các request cùng vùng dùng chung một lần tính. Lỗi hay hết lượt trong ngày thì null. */
  private climate(regionId: string, point: Point, today: string): Promise<ClimateMonth[] | null> {
    let pending = this.climateInFlight.get(regionId);
    if (!pending) {
      pending = this.loadClimate(regionId, point, today)
        .catch((error: unknown) => {
          this.logger.warn(`Không tính được khí hậu (${regionId}): ${(error as Error).message}`);
          return null;
        })
        .finally(() => this.climateInFlight.delete(regionId));
      this.climateInFlight.set(regionId, pending);
    }
    return pending;
  }

  private async loadClimate(regionId: string, point: Point, today: string): Promise<ClimateMonth[] | null> {
    const rows = (await this.db.query(
      `SELECT month, temp_max, temp_min, rain_day_ratio, precipitation_mm
         FROM region_climate WHERE region_id = $1 ORDER BY month`,
      [regionId],
    )) as Array<{ month: number; temp_max: number; temp_min: number; rain_day_ratio: number; precipitation_mm: number }>;
    if (rows.length > 0) {
      return rows.map((r) => ({
        month: Number(r.month),
        tempMax: Number(r.temp_max),
        tempMin: Number(r.temp_min),
        rainDayRatio: Number(r.rain_day_ratio),
        precipitationMm: Number(r.precipitation_mm),
      }));
    }
    if (!this.climateBudget.take(today)) {
      this.logger.warn(`Hết lượt tính khí hậu hôm nay (WEATHER_CLIMATE_DAILY_LIMIT), bỏ qua vùng ${regionId}.`);
      return null;
    }
    const year = Number(today.slice(0, 4));
    const daily = await this.client.archive(point.lat, point.lng, `${year - CLIMATE_YEARS}-01-01`, `${year - 1}-12-31`);
    const months = climateFromDaily(daily);
    if (months.length === 0) return null;
    await this.db.query(
      `INSERT INTO region_climate (region_id, month, temp_max, temp_min, rain_day_ratio, precipitation_mm)
       SELECT $1::uuid, m.month, m.temp_max, m.temp_min, m.rain_day_ratio, m.precipitation_mm
         FROM jsonb_to_recordset($2::jsonb)
           AS m(month smallint, temp_max real, temp_min real, rain_day_ratio real, precipitation_mm real)
       ON CONFLICT (region_id, month) DO NOTHING`,
      [
        regionId,
        JSON.stringify(
          months.map((m) => ({
            month: m.month,
            temp_max: m.tempMax,
            temp_min: m.tempMin,
            rain_day_ratio: m.rainDayRatio,
            precipitation_mm: m.precipitationMm,
          })),
        ),
      ],
    );
    return months;
  }
}

function bboxCenter([south, west, north, east]: Bbox): Point {
  return { lat: (south + north) / 2, lng: (west + east) / 2 };
}

/** Kết quả của `promise`, hoặc null nếu quá `ms` (promise vẫn chạy tiếp ở nền). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

Lưu ý: e2e mong `forecast` được gọi với `(11.95, 108.45)`; tâm của bbox `11.85/108.35/12.05/108.55` có thể ra `11.950000000000001`. Nếu test fail vì sai số, đổi assert trong test thành `expect(forecast.mock.calls[0][0]).toBeCloseTo(11.95)` và `expect(forecast.mock.calls[0][1]).toBeCloseTo(108.45)`.

- [ ] **Step 4: Controller, module, AppModule**

`weather.controller.ts`:

```ts
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { RegionWeather } from '@rong/shared-types';

import { WeatherQueryDto } from './dto/weather-query.dto.js';
import { WeatherService } from './weather.service.js';

@Controller('regions')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  /** Thời tiết từng ngày của chuyến: dự báo (≤ 16 ngày tới) hoặc khí hậu theo tháng. */
  @Get(':id/weather')
  get(@Param('id', ParseUUIDPipe) id: string, @Query() query: WeatherQueryDto): Promise<RegionWeather> {
    return this.weather.regionWeather(id, query.from, query.to);
  }
}
```

`weather.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration.js';
import { RegionsModule } from '../regions/regions.module.js';
import { OpenMeteoClient, WEATHER_CONFIG } from './open-meteo.client.js';
import { WeatherController } from './weather.controller.js';
import { WeatherService } from './weather.service.js';

@Module({
  imports: [RegionsModule],
  controllers: [WeatherController],
  providers: [
    WeatherService,
    OpenMeteoClient,
    {
      provide: WEATHER_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const weather = config.get<AppConfig['weather']>('weather');
        if (weather === undefined) throw new Error('Chưa nạp được cấu hình weather.');
        return weather;
      },
    },
  ],
  exports: [WeatherService],
})
export class WeatherModule {}
```

`app.module.ts`: thêm `import { WeatherModule } from './modules/weather/weather.module.js';` cạnh các import module khác (thứ tự chữ cái, sau `VisitsModule`), và `WeatherModule,` vào mảng `imports` cạnh `RecommendationsModule`.

- [ ] **Step 5: Chạy unit + e2e, phải pass**

Run: `cd apps/backend && npx vitest run src/modules/weather && npx vitest run --config vitest.config.e2e.ts test/weather.e2e-spec.ts`
Expected: PASS toàn bộ (cần migration của Task 3 đã chạy trên DB e2e).

- [ ] **Step 6: Typecheck, lint, commit**

Run: `cd apps/backend && pnpm typecheck && pnpm lint`

```bash
git add apps/backend/src/modules/weather apps/backend/src/app.module.ts apps/backend/test/weather.e2e-spec.ts
git commit -m "feat(backend): GET /regions/:id/weather with forecast and monthly climate"
```

---

### Task 5: Điền thời tiết cho thẻ gợi ý trang chủ

**Files:**
- Modify: `apps/backend/src/modules/recommendations/recommendations.module.ts:30` (thêm `WeatherModule` vào `imports`)
- Modify: `apps/backend/src/modules/recommendations/recommendations.service.ts:71-79` (constructor), `:308-333` (dựng thẻ)
- Modify: `apps/backend/test/recommendations.e2e-spec.ts` (thay client Open-Meteo, thêm test)

**Interfaces:**
- Consumes: `WeatherService.summarizeTrip(regionId, startsAt, endsAt, waitMs?)` (Task 4), `OpenMeteoClient`, `WEATHER_CONFIG` (Task 3).
- Produces: `RecommendationCard.weather` có giá trị khi có dữ liệu.

- [ ] **Step 1: Test (fail)**

Trong `test/recommendations.e2e-spec.ts`:

1. Thêm import:

```ts
import { OpenMeteoClient, WEATHER_CONFIG } from '../src/modules/weather/open-meteo.client.js';
```

2. Thêm vào `describe` hai mock và nối vào chuỗi `overrideProvider` của `beforeAll` (để e2e không bao giờ gọi mạng, kể cả khi `.env` bật `WEATHER_ENABLED`):

```ts
  const forecast = vi.fn();
  const archive = vi.fn();
```

```ts
      .overrideProvider(OpenMeteoClient)
      .useValue({ forecast, archive })
      .overrideProvider(WEATHER_CONFIG)
      .useValue({ enabled: true, forecastUrl: '', archiveUrl: '', contactEmail: 'e2e@rong.local', climateDailyLimit: 25 })
```

3. Mặc định cho Open-Meteo lỗi để các test cũ vẫn thấy `weather: null` — thêm `beforeEach` (nhớ import `beforeEach` từ vitest):

```ts
  beforeEach(() => {
    forecast.mockReset().mockRejectedValue(new Error('offline'));
    archive.mockReset().mockRejectedValue(new Error('offline'));
  });
```

4. Thêm test:

```ts
  it('thẻ có tóm tắt thời tiết khi Open-Meteo trả dữ liệu', async () => {
    forecast.mockImplementation(async () => {
      const today = vietnamDate(new Date());
      const time = Array.from({ length: 16 }, (_, i) => addDays(today, i));
      return {
        time,
        weather_code: time.map(() => 2),
        temperature_2m_max: time.map(() => 31),
        temperature_2m_min: time.map(() => 24),
        precipitation_probability_max: time.map(() => 20),
      };
    });
    archive.mockImplementation(async (_lat: number, _lng: number, from: string, to: string) => {
      const time: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) time.push(d);
      return {
        time,
        temperature_2m_max: time.map(() => 29),
        temperature_2m_min: time.map(() => 21),
        precipitation_sum: time.map(() => 0),
      };
    });
    const u = await newUser('-weather');
    const feed = await readyFeed(u.token, u.theme);
    expect(feed.items[0].weather).toMatchObject({
      condition: 'partly_cloudy',
      tempMax: expect.any(Number),
      tempMin: expect.any(Number),
    });
  });
```

Thêm import `addDays`, `vietnamDate` từ `'../src/modules/recommendations/draft-dates.js'`. Thẻ gợi ý bắt đầu thứ Bảy tới (≤ 7 ngày), nên rơi vào tầm dự báo và `condition` là `partly_cloudy` (mã 2).

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/recommendations.e2e-spec.ts`
Expected: test mới FAIL (`weather` là `null`); các test cũ PASS.

- [ ] **Step 2: Nối `WeatherService` vào service gợi ý**

`recommendations.module.ts`: thêm `import { WeatherModule } from '../weather/weather.module.js';` và `WeatherModule` vào `imports`.

`recommendations.service.ts`: import `WeatherService` từ `'../weather/weather.service.js'`, thêm `private readonly weather: WeatherService,` cuối constructor. Đổi đoạn dựng thẻ:

```ts
    return Promise.all(
      rows.map(async (r) => {
        const visits = r.days.flatMap((d) => d.items).filter((i) => i.kind === 'visit' && i.place);
        const { endsAt } = tripBounds(vietnamDate(r.starts_at), Number(r.days_count));
        const startsAt = r.starts_at.toISOString();
        const image: RegionImage | null =
          r.image_status === 'found' && !r.blocked && r.url && r.source
            ? { url: r.url, source: r.source, author: r.author, authorUrl: r.author_url, sourceUrl: r.source_url }
            : null;
        return {
          id: r.id,
          regionId: r.region_id,
          regionName: r.region_name,
          title: cardTitle(r.region_name, theme.kind === 'default' ? null : theme.label, draftCategories({ days: r.days })),
          dayCount: Number(r.days_count),
          nightCount: Number(r.days_count) - 1,
          startsAt,
          endsAt: new Date(Date.parse(endsAt)).toISOString(),
          placeCount: new Set(visits.map((i) => i.placeId)).size,
          highlights: [...new Set(visits.map((i) => i.place!.name))].slice(0, 3),
          reason: reasonText(r.reason),
          revisit: r.reason.revisit,
          image,
          estimatedCost: null,
          // Thông tin phụ: lỗi hay chậm quá 2,5 s thì null, thẻ hiện "Đang cập nhật".
          weather: await this.weather.summarizeTrip(r.region_id, startsAt, endsAt),
          savedItineraryId: r.saved_itinerary_id,
        };
      }),
    );
```

Nếu kiểu trả về của hàm chứa đoạn này được suy ra (không ghi rõ), đảm bảo hàm là `async` và trả `Promise<RecommendationCard[]>`.

- [ ] **Step 3: Chạy lại, phải pass**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/recommendations.e2e-spec.ts test/weather.e2e-spec.ts && pnpm test`
Expected: PASS toàn bộ.

- [ ] **Step 4: Typecheck, lint, commit**

Run: `cd apps/backend && pnpm typecheck && pnpm lint`

```bash
git add apps/backend/src/modules/recommendations apps/backend/test/recommendations.e2e-spec.ts
git commit -m "feat(backend): weather summary on home recommendation cards"
```

---

### Task 6: Mobile — icon, định dạng, hook, dải chip ở form tạo lịch trình

**Files:**
- Modify: `apps/mobile/src/components/ui/icon.tsx` (thêm vào `ICONS`)
- Create: `apps/mobile/src/lib/weather.ts`
- Create: `apps/mobile/src/hooks/use-region-weather.ts`
- Create: `apps/mobile/src/components/weather-strip.tsx`
- Modify: `apps/mobile/src/app/(app)/itinerary/new.tsx:172-175`

**Interfaces:**
- Consumes: `RegionWeather`, `WeatherDay`, `WeatherCondition`, `TripWeatherSummary` (Task 1); `GET /regions/:id/weather` (Task 4); `useAuth().authFetch<T>(path)`; `formatPlanDate(date)` từ `@/lib/trip-format`.
- Produces:
  - Icon mới: `partlyCloudy`, `fog`, `drizzle`, `rain`, `storm`, `drop`.
  - `lib/weather.ts`: `WEATHER_ICONS`, `WEATHER_LABELS`, `CLIMATE_NOTE`, `WEATHER_ATTRIBUTION`, `formatTemps({ kind, tempMax, tempMin })`, `rainText({ kind, rainChance })`, `summaryLabel(summary)`, `localDay(date: Date)`.
  - `useRegionWeather(regionId?, from, to, debounceMs?) → { weather: RegionWeather | null; loading: boolean }`.
  - `<WeatherStrip regionId from to />`, `<WeatherDayChip day />`.

- [ ] **Step 1: Icon**

Thêm vào `ICONS` trong `icon.tsx`, ngay sau `cloud`:

```ts
  partlyCloudy: { ios: 'cloud.sun', android: 'partly_cloudy_day', web: 'partly_cloudy_day' },
  fog: { ios: 'cloud.fog', android: 'foggy', web: 'foggy' },
  drizzle: { ios: 'cloud.drizzle', android: 'rainy_light', web: 'rainy_light' },
  rain: { ios: 'cloud.rain', android: 'rainy', web: 'rainy' },
  storm: { ios: 'cloud.bolt.rain', android: 'thunderstorm', web: 'thunderstorm' },
  drop: { ios: 'drop', android: 'water_drop', web: 'water_drop' },
```

Nếu `tsc` báo một tên Android/iOS không có trong kiểu của `expo-symbols`, đổi sang tên gần nhất mà kiểu chấp nhận (ví dụ `rainy_light` → `rainy`).

- [ ] **Step 2: `lib/weather.ts`**

```ts
import type { TripWeatherSummary, WeatherCondition, WeatherDay } from '@rong/shared-types';

import type { IconName } from '@/components/ui/icon';

export const WEATHER_ICONS: Record<WeatherCondition, IconName> = {
  clear: 'sun',
  partly_cloudy: 'partlyCloudy',
  cloudy: 'cloud',
  fog: 'fog',
  drizzle: 'drizzle',
  rain: 'rain',
  storm: 'storm',
};

export const WEATHER_LABELS: Record<WeatherCondition, string> = {
  clear: 'Nắng',
  partly_cloudy: 'Nắng có mây',
  cloudy: 'Nhiều mây',
  fog: 'Sương mù',
  drizzle: 'Mưa phùn',
  rain: 'Mưa rào',
  storm: 'Giông',
};

export const CLIMATE_NOTE =
  'Ngày còn xa: nhiệt độ và mưa thường gặp trong tháng, không phải dự báo. Dự báo có khi còn ≤ 16 ngày.';
export const WEATHER_ATTRIBUTION = 'Dữ liệu thời tiết: Open-Meteo';

/** `24°/17°`; khí hậu (hoặc tóm tắt có ngày khí hậu) thêm `~` vì không phải dự báo. */
export function formatTemps({ kind, tempMax, tempMin }: { kind: WeatherDay['kind'] | TripWeatherSummary['kind']; tempMax: number; tempMin: number }): string {
  return `${kind === 'forecast' ? '' : '~'}${tempMax}°/${tempMin}°`;
}

/** Dự báo: `60%`; khí hậu: "hay mưa" / "ít mưa". */
export function rainText({ kind, rainChance }: Pick<WeatherDay, 'kind' | 'rainChance'>): string | null {
  if (rainChance === null) return null;
  if (kind === 'forecast') return `${rainChance}%`;
  return rainChance >= 50 ? 'hay mưa' : 'ít mưa';
}

/** Mô tả trên thẻ gợi ý. */
export function summaryLabel(summary: TripWeatherSummary): string {
  if (summary.kind !== 'forecast' && (summary.rainChance ?? 0) >= 50) return 'Hay mưa';
  return WEATHER_LABELS[summary.condition];
}

/** YYYY-MM-DD theo giờ máy (app dùng ở Việt Nam). */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
```

- [ ] **Step 3: Hook `use-region-weather.ts`**

```ts
import type { RegionWeather } from '@rong/shared-types';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';

/**
 * Thời tiết từng ngày của chuyến. Chỉ hỏi server khi ngày đứng yên `debounceMs` (đang cuộn bộ chọn ngày thì chưa),
 * phản hồi của ngày cũ về muộn thì bỏ. Thông tin phụ: lỗi hay `unavailable` → `weather: null`, không báo lỗi.
 */
export function useRegionWeather(
  regionId: string | undefined,
  from: string | null,
  to: string | null,
  debounceMs = 400,
): { weather: RegionWeather | null; loading: boolean } {
  const { authFetch } = useAuth();
  const [state, setState] = useState<{ key: string; weather: RegionWeather | null } | null>(null);
  const latest = useRef(0);
  const key = regionId && from && to ? `${regionId}:${from}:${to}` : null;

  useEffect(() => {
    if (!key) return;
    const id = ++latest.current;
    const timer = setTimeout(() => {
      authFetch<RegionWeather>(`/regions/${regionId}/weather?from=${from}&to=${to}`)
        .then((w) => {
          if (id === latest.current) setState({ key, weather: w?.status === 'ready' && w.days.length > 0 ? w : null });
        })
        .catch(() => {
          if (id === latest.current) setState({ key, weather: null });
        });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [key, regionId, from, to, debounceMs, authFetch]);

  const current = state?.key === key ? state : null;
  return { weather: current?.weather ?? null, loading: key !== null && current === null };
}
```

- [ ] **Step 4: `components/weather-strip.tsx`**

```tsx
import type { WeatherDay } from '@rong/shared-types';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Icon } from '@/components/ui/icon';
import { Colors, Palette, Radius, Spacing, Type } from '@/constants/theme';
import { useRegionWeather } from '@/hooks/use-region-weather';
import { formatPlanDate } from '@/lib/trip-format';
import { CLIMATE_NOTE, formatTemps, rainText, WEATHER_ATTRIBUTION, WEATHER_ICONS, WEATHER_LABELS } from '@/lib/weather';

type WeatherStripProps = { regionId?: string; from: string | null; to: string | null };

/** Dải thời tiết từng ngày dưới ô chọn ngày. Không có dữ liệu thì không chiếm chỗ. */
export function WeatherStrip({ regionId, from, to }: WeatherStripProps) {
  const { weather, loading } = useRegionWeather(regionId, from, to);
  if (loading) {
    return (
      <View style={styles.row} accessibilityLabel="Đang tải thời tiết">
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.chip, styles.skeleton]} />
        ))}
      </View>
    );
  }
  if (!weather) return null;
  const hasClimate = weather.days.some((d) => d.kind === 'climate');
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {weather.days.map((day) => (
          <WeatherDayChip key={day.date} day={day} />
        ))}
      </ScrollView>
      {hasClimate ? <Text style={styles.note}>{CLIMATE_NOTE}</Text> : null}
      <Text style={styles.attribution}>{WEATHER_ATTRIBUTION}</Text>
    </View>
  );
}

/** Một ngày: thứ/ngày, icon, nhiệt độ, mưa. Ngày khí hậu viền đứt, màu nhạt. */
export function WeatherDayChip({ day }: { day: WeatherDay }) {
  const climate = day.kind === 'climate';
  const rain = rainText(day);
  const label = [
    formatPlanDate(day.date),
    WEATHER_LABELS[day.condition],
    formatTemps(day),
    rain ? `mưa ${rain}` : null,
    climate ? 'khí hậu thường gặp, không phải dự báo' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={[styles.chip, climate && styles.chipClimate]} accessible accessibilityLabel={label}>
      <Text style={styles.date}>{formatPlanDate(day.date)}</Text>
      <Icon name={WEATHER_ICONS[day.condition]} size={22} color={climate ? Colors.light.textSecondary : Palette.forest900} />
      <Text style={[styles.temps, climate && styles.dim]}>{formatTemps(day)}</Text>
      {rain ? (
        <View style={styles.rainRow}>
          <Icon name="drop" size={11} color={Colors.light.textSecondary} />
          <Text style={styles.rain}>{rain}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  row: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.one },
  chip: {
    width: 88,
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.mist200,
    backgroundColor: Palette.surface,
  },
  chipClimate: { borderStyle: 'dashed', backgroundColor: Palette.parchment50 },
  skeleton: { height: 84, backgroundColor: Palette.parchment100, borderColor: Palette.parchment100 },
  date: { ...Type.caption, color: Colors.light.textSecondary },
  temps: { ...Type.subhead, color: Palette.forest900 },
  dim: { color: Colors.light.textSecondary },
  rainRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  rain: { ...Type.caption, fontSize: 11, color: Colors.light.textSecondary },
  note: { ...Type.caption, color: Colors.light.textSecondary },
  attribution: { ...Type.caption, fontSize: 10, color: Colors.light.textSecondary },
});
```

- [ ] **Step 5: Đặt vào form tạo lịch trình**

`new.tsx`: import

```ts
import { WeatherStrip } from '@/components/weather-strip';
import { localDay } from '@/lib/weather';
```

Trong section "Thời gian", sau ô "Kết thúc":

```tsx
        <Section title="Thời gian">
          <DateTimeField label="Bắt đầu" value={startsAt} onChange={setStartsAt} minimumDate={now} />
          <DateTimeField label="Kết thúc" value={endsAt} onChange={setEndsAt} minimumDate={startsAt} error={showErrors ? dateError : null} />
          {dateError ? null : <WeatherStrip regionId={regionId} from={localDay(startsAt)} to={localDay(endsAt)} />}
        </Section>
```

- [ ] **Step 6: Typecheck, lint, chạy thử**

Run: `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint`
Expected: PASS.

Chạy thử (backend `pnpm start:dev` với `WEATHER_ENABLED` mặc định, Metro `pnpm --filter @rong/mobile start`), trên Android:
- Chuyến cuối tuần này: các chip đầy màu, có `%` mưa, không có dòng "Ngày còn xa".
- Đổi ngày đi sang hơn một tháng sau: chip viền đứt, có `~`, có dòng "Ngày còn xa…".
- Chọn chuyến từ ngày +14 tới +17: hai chip đầy rồi hai chip viền đứt.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/components/ui/icon.tsx apps/mobile/src/lib/weather.ts apps/mobile/src/hooks/use-region-weather.ts apps/mobile/src/components/weather-strip.tsx "apps/mobile/src/app/(app)/itinerary/new.tsx"
git commit -m "feat(mobile): daily weather strip on the new itinerary form"
```

---

### Task 7: Mobile — badge thời tiết ở chi tiết lịch trình

**Files:**
- Create: `apps/mobile/src/components/day-weather-badge.tsx`
- Modify: `apps/mobile/src/components/itinerary-view/itinerary-view.tsx:132-145` (props), `:247-260` (dòng tiêu đề ngày)
- Modify: `apps/mobile/src/app/(app)/itinerary/[id].tsx:234` (truyền `weather`)

**Interfaces:**
- Consumes: `useRegionWeather` (Task 6), `WEATHER_ICONS`, `WEATHER_LABELS`, `formatTemps`, `rainText`, `WEATHER_ATTRIBUTION` (Task 6), `BottomSheet` (`visible`, `onClose`, `header`, `children`).
- Produces: `<DayWeatherBadge day={WeatherDay} />`; prop mới `weather?: RegionWeather | null` của `ItineraryViewBody`.

- [ ] **Step 1: `components/day-weather-badge.tsx`**

```tsx
import type { WeatherDay } from '@rong/shared-types';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Icon } from '@/components/ui/icon';
import { Colors, Palette, Radius, Spacing, Type } from '@/constants/theme';
import { formatPlanDate } from '@/lib/trip-format';
import { formatTemps, rainText, WEATHER_ATTRIBUTION, WEATHER_ICONS, WEATHER_LABELS } from '@/lib/weather';

/** Badge thời tiết của ngày đang xem; bấm mở sheet giải thích. */
export function DayWeatherBadge({ day }: { day: WeatherDay }) {
  const [open, setOpen] = useState(false);
  const climate = day.kind === 'climate';
  const rain = rainText(day);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Thời tiết: ${WEATHER_LABELS[day.condition]}, ${formatTemps(day)}`}
        onPress={() => setOpen(true)}
        style={[styles.badge, climate && styles.badgeClimate]}>
        <Icon name={WEATHER_ICONS[day.condition]} size={14} color={climate ? Colors.light.textSecondary : Palette.forest900} />
        <Text style={[styles.badgeText, climate && styles.dim]}>{formatTemps(day)}</Text>
      </Pressable>
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        header={<ThemedText type="title2">Thời tiết {formatPlanDate(day.date)}</ThemedText>}>
        <View style={styles.sheetBody}>
          <View style={styles.sheetRow}>
            <Icon name={WEATHER_ICONS[day.condition]} size={28} color={Palette.forest900} />
            <Text style={styles.sheetMain}>
              {WEATHER_LABELS[day.condition]} · {formatTemps(day)}
            </Text>
          </View>
          {rain ? (
            <Text style={styles.sheetText}>
              {climate ? `Tháng này ${rain} (${day.rainChance}% số ngày có mưa).` : `Khả năng mưa ${rain}.`}
            </Text>
          ) : null}
          <Text style={styles.sheetText}>
            {climate
              ? 'Ngày còn xa nên đây là thời tiết thường gặp trong tháng (trung bình 10 năm), không phải dự báo. Dự báo có khi còn ≤ 16 ngày.'
              : 'Dự báo cho cả vùng, cập nhật vài giờ một lần.'}
          </Text>
          <Text style={styles.attribution}>{WEATHER_ATTRIBUTION}</Text>
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: Palette.parchment100,
    borderWidth: 1,
    borderColor: Palette.parchment100,
  },
  badgeClimate: { borderStyle: 'dashed', borderColor: Palette.mist200, backgroundColor: Palette.parchment50 },
  badgeText: { ...Type.caption, fontSize: 12, color: Palette.forest900 },
  dim: { color: Colors.light.textSecondary },
  sheetBody: { gap: Spacing.three, paddingBottom: Spacing.four },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sheetMain: { ...Type.headline, color: Palette.forest900 },
  sheetText: { ...Type.body, color: Colors.light.text },
  attribution: { ...Type.caption, color: Colors.light.textSecondary },
});
```

- [ ] **Step 2: Nối vào `ItineraryViewBody`**

Thêm import `RegionWeather` vào dòng import `@rong/shared-types` và `import { DayWeatherBadge } from '@/components/day-weather-badge';`. Thêm prop vào `ItineraryViewBodyProps`:

```ts
  /** Thời tiết các ngày của chuyến (chỉ lịch trình đã lưu); không có thì giữ badge "Lộ trình chính". */
  weather?: RegionWeather | null;
```

Thêm `weather` vào phần destructure của `ItineraryViewBody`, rồi trong dòng tiêu đề ngày đang chọn thay khối badge:

```tsx
            {(() => {
              const dayWeather = weather?.days.find((d) => d.date === currentDay.date);
              return dayWeather ? (
                <DayWeatherBadge day={dayWeather} />
              ) : (
                <View style={styles.dayFocusBadge}>
                  <Text style={styles.dayFocusText}>Lộ trình chính</Text>
                </View>
              );
            })()}
```

(Nếu code xung quanh không dùng IIFE trong JSX, tính `const dayWeather = currentDay ? weather?.days.find((d) => d.date === currentDay.date) : undefined;` ở đầu hàm, cạnh `currentDay`, rồi dùng ternary.)

- [ ] **Step 3: Truyền thời tiết ở màn chi tiết**

`app/(app)/itinerary/[id].tsx`: import `useRegionWeather`. Gọi hook ở đầu component (trước mọi `return` sớm), dùng ngày đầu và cuối của lịch trình:

```ts
  const firstDay = data?.days[0]?.date ?? null;
  const lastDay = data?.days[data.days.length - 1]?.date ?? null;
  const { weather } = useRegionWeather(data?.regionId, firstDay, lastDay);
```

và thêm `weather={weather}` vào `<ItineraryViewBody ... />`. (Tên biến dữ liệu lịch trình trong file là `data`; nếu khác thì dùng tên thật.) Lịch trình dài hơn 14 ngày không thể có (chuyến tối đa 7 ngày). Chuyến đã qua: API bỏ ngày cũ nên badge cũ giữ nguyên.

- [ ] **Step 4: Typecheck, lint, chạy thử**

Run: `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint`

Trên Android: mở một lịch trình tuần này → badge `☁ 24°/17°` thay "Lộ trình chính", bấm mở sheet có nguồn. Lịch trình tháng sau → badge viền đứt `~`, sheet nói "không phải dự báo". Đổi tab ngày → badge đổi theo ngày.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/day-weather-badge.tsx apps/mobile/src/components/itinerary-view/itinerary-view.tsx "apps/mobile/src/app/(app)/itinerary/[id].tsx"
git commit -m "feat(mobile): weather badge on itinerary days"
```

---

### Task 8: Mobile — thời tiết trên thẻ gợi ý

**Files:**
- Modify: `apps/mobile/src/components/recommendation-card.tsx:139-148`

**Interfaces:**
- Consumes: `card.weather: TripWeatherSummary | null` (Task 1, Task 5), `WEATHER_ICONS`, `formatTemps`, `summaryLabel` (Task 6).

- [ ] **Step 1: Đổi ô footer**

Import `WEATHER_ICONS, formatTemps, summaryLabel` từ `@/lib/weather`. Thay khối `footerLeft`:

```tsx
        <View style={styles.footerLeft}>
          <View style={styles.activityIconCircle}>
            <Icon name={card.weather ? WEATHER_ICONS[card.weather.condition] : 'sun'} size={18} color={Palette.forest900} />
          </View>
          <View>
            <Text style={styles.costLabel}>Thời tiết</Text>
            {card.weather ? (
              <Text style={styles.weatherValue} numberOfLines={1}>
                {formatTemps(card.weather)} · {summaryLabel(card.weather)}
              </Text>
            ) : (
              <Text style={styles.pending}>Đang cập nhật</Text>
            )}
          </View>
        </View>
```

Thêm style cạnh `pending` (giữ cùng cỡ chữ với `pending`, đậm màu hơn):

```ts
  weatherValue: {
    ...Type.subhead,
    color: Palette.forest900,
  },
```

Nếu `pending` dùng kiểu chữ khác `Type.subhead`, dùng đúng kiểu đó cho `weatherValue` để hai trạng thái cao bằng nhau.

- [ ] **Step 2: Typecheck, lint, chạy thử**

Run: `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint`

Trên Android: trang chủ → thẻ hiện `31°/24° · Nắng có mây` (hoặc tương tự). Tắt thời tiết ở backend (`WEATHER_ENABLED=false`, khởi động lại) → thẻ hiện "Đang cập nhật", không lỗi.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/recommendation-card.tsx
git commit -m "feat(mobile): weather summary on recommendation cards"
```

---

### Task 9: Tài liệu

**Files:**
- Modify: `apps/backend/src/modules/README.md`
- Modify: `CLAUDE.md` (bảng "External-service gateways", mục "Home recommendations")
- Modify: `docs/superpowers/specs/2026-10-19-home-recommendations-design.md`

- [ ] **Step 1: `src/modules/README.md`**

Thêm mục cho `weather/` theo đúng định dạng các mục khác trong file:

```markdown
### `weather/`
Thời tiết theo ngày của chuyến (spec `2026-10-22-trip-weather`). Gateway duy nhất tới Open-Meteo
(`OpenMeteoClient`). `GET /regions/:id/weather?from&to`: ngày còn ≤ 16 ngày nữa là dự báo (cache bộ nhớ 3 giờ theo
vùng và hôm nay), ngày xa hơn là khí hậu theo tháng (tính một lần từ 10 năm ERA5, lưu `region_climate`, tối đa
`WEATHER_CLIMATE_DAILY_LIMIT` vùng mới mỗi ngày). Lỗi nguồn → `unavailable`, không ném lỗi. `summarizeTrip` điền
`RecommendationCard.weather` (chờ tối đa 2,5 s).
```

- [ ] **Step 2: `CLAUDE.md`**

Thêm một dòng vào bảng gateway:

```markdown
| `modules/weather/OpenMeteoClient` | Open-Meteo (forecast, ERA5 archive) | Free non-commercial tier, CC BY 4.0: show "Dữ liệu thời tiết: Open-Meteo". Forecast cached in memory 3 h; monthly climate computed once per region into `region_climate`, at most `WEATHER_CLIMATE_DAILY_LIMIT` new regions/day. Weather never fails a request (`unavailable` / `weather: null`). `WEATHER_ENABLED` defaults to false under `NODE_ENV=test`. |
```

Trong mục "Home recommendations", thêm gạch đầu dòng:

```markdown
- Card weather comes from `WeatherService.summarizeTrip` (forecast within 16 days, monthly climate beyond); null when unavailable.
```

- [ ] **Step 3: Spec trang chủ**

Trong `2026-10-19-home-recommendations-design.md`, ngay dưới dòng `- Chi phí ước tính thật (F7) và thời tiết: thẻ hiện placeholder "Đang cập nhật".` thêm:

```markdown
  > **Cập nhật 2026-10-22:** thời tiết đã có (spec `2026-10-22-trip-weather`): `weather` là `TripWeatherSummary | null`.
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/modules/README.md CLAUDE.md docs/superpowers/specs/2026-10-19-home-recommendations-design.md
git commit -m "docs: document the weather module"
```
