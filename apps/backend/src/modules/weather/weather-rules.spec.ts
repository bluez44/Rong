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
    [0, 'clear'],
    [1, 'clear'],
    [2, 'partly_cloudy'],
    [3, 'cloudy'],
    [45, 'fog'],
    [48, 'fog'],
    [51, 'drizzle'],
    [57, 'drizzle'],
    [61, 'rain'],
    [67, 'rain'],
    [80, 'rain'],
    [82, 'rain'],
    [95, 'storm'],
    [99, 'storm'],
    [71, 'cloudy'],
    [86, 'cloudy'],
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
    expect(tripDates('2026-10-20', '2026-10-23', '2026-10-22')).toEqual([
      '2026-10-22',
      '2026-10-23',
    ]);
    expect(tripDates('2026-10-25', '2026-10-25', '2026-10-22')).toEqual([
      '2026-10-25',
    ]);
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
    ).toEqual([
      {
        date: '2026-10-22',
        kind: 'forecast',
        condition: 'rain',
        tempMax: 30,
        tempMin: 23,
        rainChance: 70,
      },
    ]);
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
      time: [
        '2024-01-01',
        '2024-01-02',
        '2025-01-01',
        '2025-01-02',
        '2025-02-01',
      ],
      temperature_2m_max: [20, 22, 24, 26, null],
      temperature_2m_min: [10, 12, 14, 16, null],
      precipitation_sum: [4, 0.5, 4, 0, 0],
    });
    expect(months).toEqual([
      {
        month: 1,
        tempMax: 23,
        tempMin: 13,
        rainDayRatio: 0.5,
        precipitationMm: 4.25,
      },
    ]);
  });

  it('khí hậu → ngày: mưa ≥ 50%, mây ≥ 25%, còn lại nắng', () => {
    const base = {
      month: 6,
      tempMax: 31.6,
      tempMin: 24.4,
      precipitationMm: 200,
    };
    expect(climateDay('2027-06-01', { ...base, rainDayRatio: 0.6 })).toEqual({
      date: '2027-06-01',
      kind: 'climate',
      condition: 'rain',
      tempMax: 32,
      tempMin: 24,
      rainChance: 60,
    });
    expect(
      climateDay('2027-06-01', { ...base, rainDayRatio: 0.3 }).condition,
    ).toBe('cloudy');
    expect(
      climateDay('2027-06-01', { ...base, rainDayRatio: 0.1 }).condition,
    ).toBe('clear');
  });
});

describe('summarizeDays', () => {
  const day = (over: Partial<WeatherDay>): WeatherDay => ({
    date: '2026-10-22',
    kind: 'forecast',
    condition: 'clear',
    tempMax: 30,
    tempMin: 22,
    rainChance: 10,
    ...over,
  });

  it('rỗng → null', () => {
    expect(summarizeDays([])).toBeNull();
  });

  it('có ngày mưa thì lấy mưa; có giông thì lấy giông', () => {
    expect(
      summarizeDays([day({}), day({}), day({ condition: 'rain' })])?.condition,
    ).toBe('rain');
    expect(
      summarizeDays([day({ condition: 'rain' }), day({ condition: 'storm' })])
        ?.condition,
    ).toBe('storm');
  });

  it('không mưa thì lấy loại nhiều nhất; hòa thì lấy loại nặng hơn', () => {
    expect(
      summarizeDays([
        day({ condition: 'cloudy' }),
        day({ condition: 'cloudy' }),
        day({}),
      ])?.condition,
    ).toBe('cloudy');
    expect(
      summarizeDays([day({ condition: 'partly_cloudy' }), day({})])?.condition,
    ).toBe('partly_cloudy');
  });

  it('min/max nhiệt, mưa lớn nhất, mixed khi có cả hai loại', () => {
    expect(
      summarizeDays([
        day({ tempMax: 31, tempMin: 23, rainChance: null }),
        day({ kind: 'climate', tempMax: 28, tempMin: 19, rainChance: 40 }),
      ]),
    ).toEqual({
      kind: 'mixed',
      condition: 'clear',
      tempMin: 19,
      tempMax: 31,
      rainChance: 40,
    });
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
