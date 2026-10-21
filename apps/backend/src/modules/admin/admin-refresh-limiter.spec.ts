import { describe, expect, it } from 'vitest';

import { AdminRefreshLimiter } from './admin-refresh-limiter.js';

const MINUTE = 60_000;

function limiter(dailyLimit = 3) {
  let now = 1_000_000;
  const l = new AdminRefreshLimiter(dailyLimit, () => now);
  return { l, advance: (ms: number) => (now += ms) };
}

describe('AdminRefreshLimiter', () => {
  it('mỗi vùng một lần trong 10 phút', () => {
    const { l, advance } = limiter();
    expect(l.tryConsume('a')).toBe('ok');
    expect(l.tryConsume('a')).toBe('region');
    advance(10 * MINUTE - 1);
    expect(l.tryConsume('a')).toBe('region');
    advance(1);
    expect(l.tryConsume('a')).toBe('ok');
  });

  it('vùng khác không bị chặn bởi vùng vừa làm', () => {
    const { l } = limiter();
    expect(l.tryConsume('a')).toBe('ok');
    expect(l.tryConsume('b')).toBe('ok');
  });

  it('tổng số lần trong 24 giờ', () => {
    const { l, advance } = limiter(2);
    expect(l.tryConsume('a')).toBe('ok');
    expect(l.tryConsume('b')).toBe('ok');
    expect(l.tryConsume('c')).toBe('daily');
    advance(24 * 60 * MINUTE);
    expect(l.tryConsume('c')).toBe('ok');
  });

  it('lần bị chặn không tính lượt', () => {
    const { l } = limiter(2);
    expect(l.tryConsume('a')).toBe('ok');
    expect(l.tryConsume('a')).toBe('region');
    expect(l.tryConsume('b')).toBe('ok');
  });
});
