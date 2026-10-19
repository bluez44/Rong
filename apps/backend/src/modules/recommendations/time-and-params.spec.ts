import type { ItineraryDay, ItineraryInput } from '@rong/shared-types';
import { describe, expect, it } from 'vitest';

import {
  addDays,
  DRAFT_ANCHOR_DATE,
  nextSaturday,
  shiftPlan,
  tripBounds,
  vietnamDate,
} from './draft-dates.js';
import { poolKey } from './pool-key.js';
import { DEFAULT_TRIP_PARAMS, draftInput, learnTripParams } from './trip-params.js';
import { windowFor } from './window.js';

/** Giờ Việt Nam → Date. */
const vn = (local: string) => new Date(`${local}+07:00`);

describe('windowFor', () => {
  it.each([
    ['2026-10-19T05:59:59', '2026-10-18T15:00:00', '2026-10-19T06:00:00'],
    ['2026-10-19T06:00:00', '2026-10-19T06:00:00', '2026-10-19T15:00:00'],
    ['2026-10-19T14:59:59', '2026-10-19T06:00:00', '2026-10-19T15:00:00'],
    ['2026-10-19T15:00:00', '2026-10-19T15:00:00', '2026-10-20T06:00:00'],
    ['2026-10-19T23:59:59', '2026-10-19T15:00:00', '2026-10-20T06:00:00'],
    ['2026-10-20T00:00:00', '2026-10-19T15:00:00', '2026-10-20T06:00:00'],
    ['2026-12-31T16:00:00', '2026-12-31T15:00:00', '2027-01-01T06:00:00'],
  ])('%s → %s, làm mới %s', (now, start, next) => {
    const w = windowFor(vn(now));
    expect(w.windowStart.toISOString()).toBe(vn(start).toISOString());
    expect(w.nextRefreshAt.toISOString()).toBe(vn(next).toISOString());
  });
});

describe('ngày của bản nháp', () => {
  it('ngày gốc là thứ Bảy', () => {
    expect(new Date(`${DRAFT_ANCHOR_DATE}T00:00:00Z`).getUTCDay()).toBe(6);
  });

  it.each([
    ['2026-10-19T10:00:00', '2026-10-24'], // thứ Hai
    ['2026-10-23T23:30:00', '2026-10-24'], // thứ Sáu
    ['2026-10-24T09:00:00', '2026-10-31'], // thứ Bảy → tuần sau
    ['2026-10-25T09:00:00', '2026-10-31'], // Chủ nhật → tuần sau
    ['2026-10-24T00:30:00', '2026-10-31'], // 0:30 thứ Bảy giờ VN (UTC vẫn là thứ Sáu)
  ])('nextSaturday(%s) = %s', (now, expected) => {
    expect(nextSaturday(vn(now))).toBe(expected);
  });

  it('vietnamDate: 0:30 giờ Việt Nam vẫn là ngày hôm đó', () => {
    expect(vietnamDate(new Date('2026-10-23T17:30:00Z'))).toBe('2026-10-24');
  });

  it('tripBounds: 8:00 ngày đầu → 18:00 ngày cuối', () => {
    expect(tripBounds('2026-01-03', 2)).toEqual({
      startsAt: '2026-01-03T08:00:00+07:00',
      endsAt: '2026-01-04T18:00:00+07:00',
    });
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('shiftPlan dời mọi ngày và giờ, giữ nguyên giờ trong ngày', () => {
    const day: ItineraryDay = {
      id: 'day-1',
      date: '2026-01-03',
      startsAt: '2026-01-03T08:00:00+07:00',
      endsAt: '2026-01-03T18:00:00+07:00',
      items: [
        {
          id: 'a',
          kind: 'visit',
          placeId: 'p',
          place: null,
          dayPart: 'morning',
          order: 0,
          startsAt: '2026-01-03T08:30:00+07:00',
          endsAt: '2026-01-03T09:45:00+07:00',
          isAiSuggested: false,
        },
      ],
    };
    const input = draftInput('r', [], DEFAULT_TRIP_PARAMS);
    const shifted = shiftPlan({ input, days: [day] }, '2026-10-24');
    expect(shifted.input.startsAt).toBe('2026-10-24T08:00:00+07:00');
    expect(shifted.input.endsAt).toBe('2026-10-25T18:00:00+07:00');
    expect(shifted.days[0].date).toBe('2026-10-24');
    expect(shifted.days[0].items[0].startsAt).toBe('2026-10-24T08:30:00+07:00');
    expect(shifted.days[0].items[0].endsAt).toBe('2026-10-24T09:45:00+07:00');
    // Không sửa bản gốc.
    expect(day.date).toBe('2026-01-03');
  });
});

describe('poolKey', () => {
  const base = {
    regionId: 'r1',
    categories: ['cafe', 'nature'] as const,
    trip: DEFAULT_TRIP_PARAMS,
    listVersion: new Date('2026-10-01T00:00:00Z'),
  };

  it('không phụ thuộc thứ tự và trùng lặp danh mục', () => {
    expect(poolKey({ ...base, categories: ['cafe', 'nature'] })).toBe(
      poolKey({ ...base, categories: ['nature', 'cafe', 'cafe'] }),
    );
  });

  it('đổi list_version, số ngày hoặc đối tượng → khóa khác', () => {
    const k = poolKey({ ...base, categories: [...base.categories] });
    expect(
      poolKey({ ...base, categories: [...base.categories], listVersion: new Date('2026-10-02T00:00:00Z') }),
    ).not.toBe(k);
    expect(
      poolKey({ ...base, categories: [...base.categories], trip: { ...base.trip, daysCount: 3 } }),
    ).not.toBe(k);
    expect(
      poolKey({ ...base, categories: [...base.categories], trip: { ...base.trip, travelParty: 'friends' } }),
    ).not.toBe(k);
  });

  it('số người lớn, trẻ em không nằm trong khóa', () => {
    const k = poolKey({ ...base, categories: [...base.categories] });
    expect(
      poolKey({ ...base, categories: [...base.categories], trip: { ...base.trip, adults: 5, children: 2 } }),
    ).toBe(k);
  });
});

describe('learnTripParams', () => {
  const input = (over: Partial<ItineraryInput>): ItineraryInput => ({
    ...draftInput('r', [], DEFAULT_TRIP_PARAMS),
    ...over,
  });

  it('người mới → mặc định', () => {
    expect(learnTripParams([])).toEqual({
      travelParty: 'couple',
      adults: 2,
      children: 0,
      pace: 'moderate',
      budgetTier: 'moderate',
      daysCount: 2,
    });
  });

  it('lấy giá trị hay gặp nhất, hòa thì lấy lịch trình mới hơn; số ngày lấy trung vị', () => {
    const learned = learnTripParams([
      input({ travelParty: 'friends', adults: 4, startsAt: '2026-09-01T08:00:00+07:00', endsAt: '2026-09-03T18:00:00+07:00' }),
      input({ travelParty: 'family_with_kids', adults: 2, children: 2, pace: 'relaxed', startsAt: '2026-08-01T08:00:00+07:00', endsAt: '2026-08-01T18:00:00+07:00' }),
      input({ travelParty: 'friends', adults: 4, startsAt: '2026-07-01T08:00:00+07:00', endsAt: '2026-07-04T18:00:00+07:00' }),
    ]);
    expect(learned.travelParty).toBe('friends');
    expect(learned.adults).toBe(4);
    expect(learned.children).toBe(0);
    expect(learned.daysCount).toBe(3); // 3, 1, 4 → trung vị 3
  });

  it('số ngày giới hạn 1–7', () => {
    expect(
      learnTripParams([input({ startsAt: '2026-09-01T08:00:00+07:00', endsAt: '2026-09-20T18:00:00+07:00' })]).daysCount,
    ).toBe(7);
  });
});

describe('draftInput', () => {
  it('xếp từ ngày gốc, không có điểm chọn sẵn, ưu tiên danh mục', () => {
    const input = draftInput('r1', ['cafe'], { ...DEFAULT_TRIP_PARAMS, daysCount: 3 });
    expect(input).toMatchObject({
      regionId: 'r1',
      planningMode: 'ai',
      startsAt: '2026-01-03T08:00:00+07:00',
      endsAt: '2026-01-05T18:00:00+07:00',
      selectedPlaceIds: [],
      allowAiSuggestions: true,
      preferredCategories: ['cafe'],
    });
  });
});
