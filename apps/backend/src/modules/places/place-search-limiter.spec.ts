import { describe, expect, it } from 'vitest';

import { PlaceSearchLimiter } from './place-search-limiter.js';

describe('PlaceSearchLimiter', () => {
  it('cho tối đa `limit` lượt mỗi người trong cửa sổ, người khác tính riêng', () => {
    let t = 0;
    const limiter = new PlaceSearchLimiter(2, 1000, () => t);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
    expect(limiter.tryConsume('b')).toBe(true);
    t = 1001;
    expect(limiter.tryConsume('a')).toBe(true);
  });

  it('cửa sổ trượt: lượt cũ hết hạn từng cái một', () => {
    let t = 0;
    const limiter = new PlaceSearchLimiter(2, 1000, () => t);
    limiter.tryConsume('a'); // t=0
    t = 500;
    limiter.tryConsume('a'); // t=500
    t = 1001; // lượt t=0 hết hạn, lượt t=500 còn
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
  });
});
