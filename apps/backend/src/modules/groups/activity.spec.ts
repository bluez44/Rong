import { describe, expect, it } from 'vitest';

import {
  decodeActivityCursor,
  encodeActivityCursor,
  MERGE_WINDOW_MS,
  shouldMerge,
} from './activity.js';

describe('shouldMerge — gộp itinerary_updated', () => {
  const now = new Date('2026-10-02T10:00:00Z');
  const last = {
    type: 'itinerary_updated',
    actorId: 'u1',
    itineraryId: 'i1',
    createdAt: new Date(now.getTime() - 5 * 60 * 1000),
  };
  const next = { type: 'itinerary_updated', actorId: 'u1', itineraryId: 'i1' };

  it('cùng người, cùng lịch trình, dưới 10 phút thì gộp', () => {
    expect(shouldMerge(last, next, now)).toBe(true);
  });

  it('không gộp khi khác người, khác lịch trình, quá 10 phút hoặc khác loại', () => {
    expect(shouldMerge(last, { ...next, actorId: 'u2' }, now)).toBe(false);
    expect(shouldMerge(last, { ...next, itineraryId: 'i2' }, now)).toBe(false);
    expect(
      shouldMerge(
        { ...last, createdAt: new Date(now.getTime() - MERGE_WINDOW_MS) },
        next,
        now,
      ),
    ).toBe(false);
    expect(shouldMerge({ ...last, type: 'place_added' }, next, now)).toBe(
      false,
    );
    expect(shouldMerge(last, { ...next, type: 'place_added' }, now)).toBe(
      false,
    );
    expect(shouldMerge(undefined, next, now)).toBe(false);
  });
});

describe('con trỏ nhật ký', () => {
  const id = '3f1c2b4e-8a9d-4c7e-9f0a-1b2c3d4e5f60';
  const t = '2026-10-02 10:00:00.123456+00';

  it('mã hóa rồi giải mã ra đúng giá trị', () => {
    expect(decodeActivityCursor(encodeActivityCursor({ t, id }))).toEqual({
      t,
      id,
    });
  });

  it('con trỏ hỏng thì coi như trang đầu', () => {
    expect(decodeActivityCursor(undefined)).toBeNull();
    expect(decodeActivityCursor('rac')).toBeNull();
    expect(
      decodeActivityCursor(encodeActivityCursor({ t: 'không phải ngày', id })),
    ).toBeNull();
    expect(
      decodeActivityCursor(encodeActivityCursor({ t, id: "x'; DROP TABLE" })),
    ).toBeNull();
  });
});
