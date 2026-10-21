import { describe, expect, it } from 'vitest';

import { cacheKey, formatAddress } from './reverse-geocode.js';

describe('formatAddress', () => {
  it('số nhà + đường, phường, quận, tỉnh; bỏ trùng và quốc gia', () => {
    expect(
      formatAddress({
        house_number: '12',
        road: 'Đường Trần Hưng Đạo',
        quarter: 'Phường 10',
        suburb: 'Phường 10',
        city: 'Đà Lạt',
        state: 'Lâm Đồng',
        country: 'Việt Nam',
        postcode: '66000',
      }),
    ).toBe('12 Đường Trần Hưng Đạo, Phường 10, Đà Lạt, Lâm Đồng');
  });

  it('chỉ có xã và tỉnh', () => {
    expect(
      formatAddress({
        village: 'Xã Tà Xùa',
        state: 'Sơn La',
        country: 'Việt Nam',
      }),
    ).toBe('Xã Tà Xùa, Sơn La');
  });

  it('không có gì dùng được → null', () => {
    expect(formatAddress({ country: 'Việt Nam' })).toBeNull();
    expect(formatAddress(undefined)).toBeNull();
  });
});

describe('cacheKey', () => {
  it('cùng ô ~10 m', () => {
    expect(cacheKey(11.94012, 108.44018)).toBe(cacheKey(11.9401, 108.4402));
  });
});
