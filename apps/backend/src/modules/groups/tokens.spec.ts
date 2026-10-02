import { describe, expect, it } from 'vitest';

import { hashToken, isTokenShape, newToken } from './tokens.js';

describe('token link', () => {
  it('43 ký tự base64url, mỗi lần một khác', () => {
    const a = newToken();
    const b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(isTokenShape(a)).toBe(true);
  });

  it('băm SHA-256 hex, ổn định', () => {
    const t = newToken();
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(hashToken(newToken()));
  });

  it('từ chối chuỗi sai định dạng', () => {
    expect(isTokenShape('')).toBe(false);
    expect(isTokenShape('abc')).toBe(false);
    expect(isTokenShape(`${newToken()}x`)).toBe(false);
    expect(isTokenShape('a'.repeat(42) + '%')).toBe(false);
    expect(isTokenShape('a'.repeat(42) + '\0')).toBe(false);
  });
});
