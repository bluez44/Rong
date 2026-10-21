import { describe, expect, it } from 'vitest';

import { mergeNotes, validateNotes } from './place-notes.js';

const empty = {
  note: null,
  openingHours: null,
  priceMin: null,
  priceMax: null,
};

describe('mergeNotes', () => {
  it('trường không gửi thì giữ, gửi null thì xóa', () => {
    const current = { ...empty, note: 'Ngon', priceMin: 50_000 };
    expect(
      mergeNotes(current, { priceMin: null, openingHours: '07:00-22:00' }),
    ).toEqual({
      note: 'Ngon',
      openingHours: '07:00-22:00',
      priceMin: null,
      priceMax: null,
    });
  });

  it('mọi trường rỗng thì trả null (xóa dòng)', () => {
    expect(mergeNotes({ ...empty, note: 'x' }, { note: '  ' })).toBeNull();
  });
});

describe('validateNotes', () => {
  it('giờ không đọc được → INVALID_OPENING_HOURS', () => {
    expect(() =>
      validateNotes({ ...empty, openingHours: 'mở cả ngày' }),
    ).toThrow(/Giờ mở cửa/);
  });

  it('giá đến nhỏ hơn giá từ → INVALID_PRICE', () => {
    expect(() =>
      validateNotes({ ...empty, priceMin: 200, priceMax: 100 }),
    ).toThrow(/Giá/);
  });

  it('hợp lệ thì không ném', () => {
    expect(() =>
      validateNotes({
        note: 'a',
        openingHours: 'Mo-Su 07:00-22:00',
        priceMin: 0,
        priceMax: 0,
      }),
    ).not.toThrow();
  });
});
