import { describe, expect, it } from 'vitest';

import { pickBoundary } from './boundary.service.js';
import { foldText, isWardName, searchKey } from './search-text.js';

describe('searchKey', () => {
  it.each([
    ['Đà Lạt', 'da lat'],
    ['  ĐÀ   LẠT ', 'da lat'],
    ['Tỉnh Lâm Đồng', 'lam dong'],
    ['Thành phố Hồ Chí Minh', 'ho chi minh'],
    ['TP. Hồ Chí Minh', 'ho chi minh'],
    ['Bà Rịa - Vũng Tàu', 'ba ria vung tau'],
    ['Mũi Né – Phan Thiết', 'mui ne phan thiet'],
    ['Khánh Hoà', 'khanh hoa'],
    ['Thị xã Sa Pa', 'sa pa'],
  ])('%s → %s', (input, expected) => {
    expect(searchKey(input)).toBe(expected);
  });

  it('không xóa sạch tên chỉ gồm tiền tố', () => {
    expect(searchKey('Huyện')).toBe('huyen');
    expect(foldText('Đặc khu Phú Quốc')).toBe('dac khu phu quoc');
  });

  it('nhận ra tên xã/phường/đặc khu', () => {
    expect(isWardName('Phường Bến Thành')).toBe(true);
    expect(isWardName('Đặc khu Côn Đảo')).toBe(true);
    expect(isWardName('Đà Lạt')).toBe(false);
  });
});

describe('pickBoundary', () => {
  const candidates = [
    { type: 'relation' as const, id: 1, tags: { name: 'Tỉnh Bình Thuận' } },
    {
      type: 'relation' as const,
      id: 2,
      tags: { name: 'Tỉnh Bà Rịa – Vũng Tàu' },
    },
    {
      type: 'relation' as const,
      id: 3,
      tags: { name: 'Hue', 'name:vi': 'Thành phố Huế' },
    },
  ];

  it('khớp theo tên đã bỏ dấu và tiền tố, kể cả khác kiểu gạch nối', () => {
    expect(pickBoundary(candidates, 'Bình Thuận')?.id).toBe(1);
    expect(pickBoundary(candidates, 'Bà Rịa - Vũng Tàu')?.id).toBe(2);
    expect(pickBoundary(candidates, 'Huế')?.id).toBe(3);
    expect(pickBoundary(candidates, 'Ninh Thuận')).toBeUndefined();
  });
});
