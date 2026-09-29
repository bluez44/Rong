import type { ItineraryEditItem } from '@rong/shared-types';
import { describe, expect, it } from 'vitest';

import type { DayWindow } from './days.js';
import type { Candidate } from './planning.types.js';
import { parseClock, retimeDay, type RetimeContext } from './retime.js';

const c = (id: string, patch: Partial<Candidate> = {}): Candidate => ({
  id,
  name: `Điểm ${id}`,
  category: 'nature',
  score: 50,
  description: null,
  openingHours: null,
  mandatory: true,
  lat: 11.94,
  lng: 108.44,
  ...patch,
});

// Thứ Hai 05/10/2026, 08:00–21:00.
const day: DayWindow = {
  index: 0,
  date: '2026-10-05',
  weekday: 0,
  start: 480,
  end: 1260,
  isFirst: true,
  isLast: false,
};

const ctx = (places: Candidate[], patch: Partial<RetimeContext> = {}) => ({
  day,
  transport: 'car' as const,
  accommodation: null,
  places: new Map(places.map((p) => [p.id, p])),
  ...patch,
});

const visit = (
  placeId: string,
  patch: Partial<ItineraryEditItem> = {},
): ItineraryEditItem => ({
  id: `item-${placeId}`,
  kind: 'visit',
  placeId,
  durationMinutes: 60,
  ...patch,
});

describe('retimeDay', () => {
  it('nối các mục theo thứ tự gửi lên, cộng thời gian di chuyển', () => {
    const a = c('a');
    const b = c('b', { lat: 11.96 }); // ~3 km
    const { items } = retimeDay([visit('a'), visit('b')], ctx([a, b]));

    expect(items.map((i) => i.placeId)).toEqual(['a', 'b']);
    expect(items[0].startsAt).toBe('2026-10-05T08:00:00+07:00');
    expect(items[0].endsAt).toBe('2026-10-05T09:00:00+07:00');
    expect(items[0].travelMinutesFromPrevious).toBeNull();
    const leg = items[1].travelMinutesFromPrevious!;
    expect(leg).toBeGreaterThan(5);
    expect(items[1].startsAt).toBe(
      `2026-10-05T09:${String(leg).padStart(2, '0')}:00+07:00`,
    );
    expect(items.map((i) => i.order)).toEqual([0, 1]);
    expect(items[0].id).toBe('item-a');
  });

  it('giờ ghim: không bắt đầu sớm hơn, nhưng không lùi về trước mục trước', () => {
    const { items } = retimeDay(
      [
        visit('a', { startTime: '10:30' }),
        visit('b', { startTime: '09:00', durationMinutes: 30 }),
      ],
      ctx([c('a'), c('b')]),
    );
    expect(items[0].startsAt).toBe('2026-10-05T10:30:00+07:00');
    expect(items[0].fixedStart).toBe(true);
    // Cùng tọa độ: đi bộ 3 phút.
    expect(items[1].startsAt).toBe('2026-10-05T11:33:00+07:00');
  });

  it('cảnh báo đóng cửa, chặng dài, ngày quá 10 tiếng và thiếu bữa', () => {
    const museum = c('m', {
      category: 'culture',
      openingHours: 'Mo-Su 13:00-17:00',
    });
    const far = c('far', { lat: 12.5 }); // ~80 km
    const { warnings } = retimeDay(
      [visit('m'), visit('far', { durationMinutes: 600 })],
      ctx([museum, far]),
    );
    const types = warnings.map((w) => w.type);
    expect(types).toContain('place_closed');
    expect(types).toContain('long_travel_leg');
    expect(types).toContain('overloaded_day');
    expect(types.filter((t) => t === 'missing_meal')).toHaveLength(2);
    expect(warnings.find((w) => w.type === 'place_closed')!.itemId).toBe(
      'item-m',
    );
  });

  it('bữa ăn hoặc quán ăn đúng khung giờ thì không cảnh báo thiếu bữa', () => {
    const { warnings } = retimeDay(
      [
        visit('a', { startTime: '11:30' }),
        { kind: 'meal', mealType: 'lunch', placeId: 'f', durationMinutes: 60 },
        visit('g', { startTime: '18:30' }),
      ],
      ctx([c('a'), c('f', { category: 'food' }), c('g', { category: 'food' })]),
    );
    expect(warnings.filter((w) => w.type === 'missing_meal')).toEqual([]);
  });

  it('ngày sau ngày đầu tính chặng đầu từ nơi ở; mục nghỉ không cần địa điểm', () => {
    const hotel = c('h', { category: 'stay', lat: 11.96 });
    const { items } = retimeDay(
      [{ kind: 'rest', placeId: null, durationMinutes: 30 }, visit('a')],
      ctx([c('a')], { accommodation: hotel, day: { ...day, isFirst: false } }),
    );
    expect(items[0].place).toBeNull();
    expect(items[1].travelMinutesFromPrevious).toBeGreaterThan(5);
    expect(items[1].id).toMatch(/^item-a$/);
  });
});

describe('parseClock', () => {
  it.each([
    ['08:05', 485],
    ['23:59', 1439],
    ['24:00', null],
    ['8:05', null],
  ])('%s → %s', (value, expected) => {
    expect(parseClock(value)).toBe(expected);
  });
});
