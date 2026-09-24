import { describe, expect, it } from 'vitest';

import {
  assignToDays,
  dayCapacity,
  orderNearestFirst,
  pickExtras,
} from './clustering.js';
import { estimateCost } from './cost.js';
import { buildDays, type DayWindow } from './days.js';
import type { Candidate, PlannedStop } from './planning.types.js';
import { PARTY_RULES, targetStopsPerDay } from './rules.js';
import { scheduleDay } from './scheduler.js';
import { estimateLeg } from './travel.js';

let seq = 0;
const place = (patch: Partial<Candidate> = {}): Candidate => ({
  id: `p${++seq}`,
  name: `Điểm ${seq}`,
  category: 'check_in',
  score: 50,
  description: null,
  openingHours: null,
  mandatory: false,
  lat: 11.94,
  lng: 108.44,
  ...patch,
});
const stop = (candidate: Candidate, visitMinutes = 60): PlannedStop => ({
  candidate,
  visitMinutes,
  reason: null,
  openingHoursHint: null,
  isAiSuggested: false,
});
const hhmm = (iso: string) => iso.slice(11, 16);
// 2026-10-05 là thứ Hai.
const day = (patch: Partial<DayWindow> = {}): DayWindow => ({
  index: 0,
  date: '2026-10-05',
  weekday: 0,
  start: 8 * 60,
  end: 22 * 60,
  isFirst: false,
  isLast: false,
  ...patch,
});

describe('buildDays', () => {
  it('ngày đầu từ giờ khởi hành, ngày cuối tới giờ về, theo giờ Việt Nam', () => {
    const days = buildDays(
      '2026-10-02T13:00:00+07:00',
      '2026-10-04T15:00:00+07:00',
      PARTY_RULES.couple,
    );

    expect(
      days.map((d) => [d.date, d.start / 60, d.end / 60, d.weekday]),
    ).toEqual([
      ['2026-10-02', 13, 22, 4], // thứ Sáu
      ['2026-10-03', 8, 22, 5],
      ['2026-10-04', 8, 15, 6],
    ]);
    expect(days[0].isFirst && days[2].isLast).toBe(true);
  });

  it('bỏ ngày chỉ còn dưới 1 tiếng', () => {
    const days = buildDays(
      '2026-10-02T21:30:00+07:00',
      '2026-10-03T12:00:00+07:00',
      PARTY_RULES.couple,
    );
    expect(days.map((d) => d.date)).toEqual(['2026-10-03']);
  });
});

describe('estimateLeg', () => {
  it('gần thì đi bộ, xa thì theo tốc độ phương tiện', () => {
    const a = { lat: 11.94, lng: 108.44 };
    expect(
      estimateLeg(a, { lat: 11.9405, lng: 108.4405 }, 'car').minutes,
    ).toBeLessThanOrEqual(5);
    // ~10 km đường chim bay → ~13.5 km đường → ~33 phút + 5 bằng ô tô.
    const leg = estimateLeg(a, { lat: 12.03, lng: 108.44 }, 'car');
    expect(leg.km).toBeCloseTo(13.5, 0);
    expect(leg.minutes).toBeGreaterThan(30);
    expect(leg.minutes).toBeLessThan(45);
  });
});

describe('chọn và phân ngày', () => {
  it('pickExtras: bỏ danh mục đối tượng tránh, không để một danh mục áp đảo, bỏ nơi quá xa nơi ở', () => {
    const pool = [
      ...Array.from({ length: 6 }, () =>
        place({ category: 'cafe', score: 90 }),
      ),
      place({ category: 'nightlife', score: 99 }),
      place({ category: 'nature', score: 40 }),
      place({ category: 'culture', score: 30 }),
      place({ category: 'nature', score: 95, lat: 13.5 }), // quá xa
    ];
    const picked = pickExtras({
      pool,
      slots: 5,
      rules: PARTY_RULES.family_with_kids,
      preferred: [],
      accommodation: { lat: 11.94, lng: 108.44 },
      transport: 'car',
    });

    expect(picked.some((c) => c.category === 'nightlife')).toBe(false);
    expect(
      picked.filter((c) => c.category === 'cafe').length,
    ).toBeLessThanOrEqual(2);
    expect(picked.some((c) => c.lat === 13.5)).toBe(false);
  });

  it('assignToDays: gom theo khu vực, giữ mọi điểm bắt buộc', () => {
    const north = [0, 1, 2].map((i) =>
      place({ lat: 12.1 + i * 0.001, mandatory: i === 0 }),
    );
    const south = [0, 1, 2].map((i) =>
      place({ lat: 11.8 + i * 0.001, mandatory: i === 0 }),
    );
    const days = [day(), day({ index: 1 })];

    const result = assignToDays([...north, ...south], days, [3, 3]);

    const byLat = result.map((list) =>
      list.map((c) => c.lat > 12).every((v, _, a) => v === a[0]),
    );
    expect(byLat).toEqual([true, true]); // mỗi ngày một khu vực
    expect(result.flat()).toHaveLength(6);
  });

  it('assignToDays: quá tải thì bỏ điểm bổ sung thấp điểm nhất, không bỏ điểm bắt buộc', () => {
    const list = [
      place({ mandatory: true, score: 10 }),
      place({ score: 20 }),
      place({ score: 80 }),
    ];
    const [only] = assignToDays(list, [day()], [2]);
    expect(only.map((c) => c.score).sort((a, b) => a - b)).toEqual([10, 80]);
  });

  it('dayCapacity co lại theo phần ngày dùng được', () => {
    const rules = PARTY_RULES.couple; // 8h–22h, mục tiêu 4–5
    expect(targetStopsPerDay(rules, 'packed')).toBe(5);
    expect(dayCapacity(day({ start: 15 * 60 }), rules, 4)).toBe(2);
  });

  it('orderNearestFirst đi từ nơi ở ra điểm gần nhất trước', () => {
    const near = place({ lat: 11.95 });
    const far = place({ lat: 12.1 });
    expect(
      orderNearestFirst([far, near], { lat: 11.94, lng: 108.44 }).map(
        (c) => c.id,
      ),
    ).toEqual([near.id, far.id]);
  });
});

describe('scheduleDay', () => {
  const food = () =>
    [0, 1, 2].map((i) => place({ category: 'food', lat: 11.941 + i * 0.001 }));

  it('ngày đầu khởi hành 9h: không bữa sáng; chèn bữa trưa, bữa tối từ quán gần lộ trình', () => {
    const stops = [
      stop(place(), 120),
      stop(place(), 120),
      stop(place(), 120),
      stop(place(), 120),
    ];
    const result = scheduleDay(stops, {
      day: day({ start: 9 * 60, isFirst: true }),
      rules: PARTY_RULES.couple,
      transport: 'motorbike',
      accommodation: null,
      foodPool: food(),
      usedFood: new Set(),
    });

    expect(
      result.items.map(
        (i) => `${i.kind}:${hhmm(i.startsAt)}-${hhmm(i.endsAt)}`,
      ),
    ).toEqual([
      'visit:09:00-11:00',
      'meal:11:03-12:03',
      'visit:12:06-14:06',
      'visit:14:09-16:09',
      'visit:16:12-18:12',
      'meal:18:15-19:30',
    ]);
    expect(result.unscheduled).toEqual([]);
    expect(
      new Set(
        result.items.filter((i) => i.kind === 'meal').map((i) => i.placeId),
      ).size,
    ).toBe(2);
  });

  it('điểm đóng cửa hôm đó → "Chưa xếp được"; chưa mở thì chờ', () => {
    const closedMonday = place({ openingHours: 'Tu-Su 08:00-17:00' });
    const opensAt10 = place({ openingHours: 'Mo-Su 10:00-17:00' });
    const result = scheduleDay([stop(closedMonday), stop(opensAt10)], {
      day: day({ start: 9 * 60, end: 11 * 60 + 30 }),
      rules: PARTY_RULES.solo,
      transport: 'motorbike',
      accommodation: null,
      foodPool: [],
      usedFood: new Set(),
    });

    expect(result.unscheduled).toEqual([
      { placeId: closedMonday.id, reason: 'Đóng cửa vào ngày 1 (2026-10-05)' },
    ]);
    expect(hhmm(result.items[0].startsAt)).toBe('10:00');
  });

  it('gia đình có trẻ nhỏ: nghỉ trưa tại nơi ở sau bữa trưa', () => {
    const hotel = place({ category: 'stay', lat: 11.95 });
    const result = scheduleDay([stop(place(), 180), stop(place(), 60)], {
      day: day(),
      rules: PARTY_RULES.family_with_kids,
      transport: 'car',
      accommodation: hotel,
      foodPool: food(),
      usedFood: new Set(),
    });

    const kinds = result.items.map((i) => i.kind);
    // Ngày giữa chuyến: có bữa sáng dù khung giờ ngày bắt đầu lúc 8h.
    expect(kinds.slice(0, 4)).toEqual(['meal', 'visit', 'meal', 'rest']);
    expect(result.items[0]).toMatchObject({ mealType: 'breakfast' });
    // Ngày bắt đầu ở nơi ở lúc 8h, đi ~1 km tới quán.
    expect(hhmm(result.items[0].startsAt)).toBe('08:07');
    expect(result.items[0].travelMinutesFromPrevious).toBe(7);
    const rest = result.items.find((i) => i.kind === 'rest')!;
    expect(rest.placeId).toBe(hotel.id);
    expect((Date.parse(rest.endsAt) - Date.parse(rest.startsAt)) / 60_000).toBe(
      150,
    );
  });

  it('tràn quá cuối ngày → "Chưa xếp được"; thiếu quán ăn → cảnh báo', () => {
    const result = scheduleDay([stop(place(), 240), stop(place(), 240)], {
      day: day({ start: 14 * 60, end: 19 * 60 }),
      rules: PARTY_RULES.solo,
      transport: 'motorbike',
      accommodation: null,
      foodPool: [],
      usedFood: new Set(),
    });

    expect(result.unscheduled[0].reason).toContain('Không đủ thời gian');
    expect(result.warnings.map((w) => w.type)).toContain('missing_meal');
  });
});

describe('giờ mở cửa thông thường khi không có dữ liệu', () => {
  it('không xếp điểm văn hóa không rõ giờ vào buổi tối; điểm check-in thì được', () => {
    const museum = place({ category: 'culture' });
    const viewpoint = place({ category: 'check_in' });
    const result = scheduleDay([stop(museum), stop(viewpoint)], {
      day: day({ start: 19 * 60, isFirst: true }),
      rules: PARTY_RULES.friends,
      transport: 'motorbike',
      accommodation: null,
      foodPool: [],
      usedFood: new Set(),
    });

    expect(result.unscheduled).toEqual([
      { placeId: museum.id, reason: 'Không kịp trong giờ mở cửa thông thường' },
    ]);
    expect(result.items.map((i) => i.placeId)).toEqual([viewpoint.id]);
  });

  it('bữa đầu ngày khi chưa biết điểm xuất phát bắt đầu đúng giờ, không cộng đường đi', () => {
    const result = scheduleDay([stop(place({ lat: 12.0 }))], {
      day: day(),
      rules: PARTY_RULES.friends,
      transport: 'motorbike',
      accommodation: null,
      foodPool: [place({ category: 'food', lat: 11.9 })],
      usedFood: new Set(),
    });
    expect(hhmm(result.items[0].startsAt)).toBe('08:00');
    expect(result.items[0].travelMinutesFromPrevious).toBeNull();
  });
});

describe('estimateCost', () => {
  it('tính theo người, bữa, phương tiện và lưu trú; khoảng thấp–cao', () => {
    const result = scheduleDay([stop(place({ category: 'kids' }), 120)], {
      day: day({ start: 10 * 60, end: 13 * 60 + 30 }),
      rules: PARTY_RULES.family_with_kids,
      transport: 'car',
      accommodation: null,
      foodPool: [place({ category: 'food' })],
      usedFood: new Set(),
    });

    const cost = estimateCost({
      items: result.items,
      adults: 2,
      children: 2,
      budgetTier: 'moderate',
      transport: 'car',
      days: 1,
      totalKm: 20,
      nights: 1,
      hasAccommodation: true,
    });

    // Vé khu vui chơi: (2 + 2×0.5) × 100–300k.
    expect(cost.byCategory.tickets).toEqual({
      minVnd: 300_000,
      maxVnd: 900_000,
    });
    // Một bữa trưa: (2 + 2×0.6) × 80–200k.
    expect(cost.byCategory.food).toEqual({ minVnd: 256_000, maxVnd: 640_000 });
    // Một ô tô 1 ngày + 20 km.
    expect(cost.byCategory.transport).toEqual({
      minVnd: 850_000,
      maxVnd: 1_370_000,
    });
    // 1 phòng × 1 đêm.
    expect(cost.byCategory.accommodation).toEqual({
      minVnd: 600_000,
      maxVnd: 1_200_000,
    });
    expect(cost.total.minVnd).toBe(2_006_000);
    expect(cost.perPerson).toEqual({ minVnd: 502_000, maxVnd: 1_028_000 });
  });
});
