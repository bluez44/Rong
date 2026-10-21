import { describe, expect, it } from 'vitest';

import { isAdminEmail, keyMatches } from './admin-access.js';

describe('keyMatches', () => {
  const key = 'k'.repeat(40);

  it('đúng khóa', () => {
    expect(keyMatches(key, key)).toBe(true);
  });

  it.each([
    ['sai một ký tự', `${'k'.repeat(39)}x`],
    ['ngắn hơn', 'k'.repeat(39)],
    ['dài hơn', `${key}k`],
    ['rỗng', ''],
    ['thiếu header', undefined],
    ['header lặp (mảng)', [key, key]],
  ])('%s thì không khớp', (_name, presented) => {
    expect(keyMatches(presented, key)).toBe(false);
  });
});

describe('isAdminEmail', () => {
  const admins = ['admin@rong.vn', 'boss@example.com'];

  it('email đã xác minh có trong danh sách, không phân biệt hoa thường', () => {
    expect(
      isAdminEmail({ email: 'Admin@Rong.VN', emailVerified: true }, admins),
    ).toBe(true);
  });

  it('email chưa xác minh thì không phải admin', () => {
    expect(
      isAdminEmail({ email: 'admin@rong.vn', emailVerified: false }, admins),
    ).toBe(false);
  });

  it('không có email hoặc không trong danh sách', () => {
    expect(isAdminEmail({ email: null, emailVerified: false }, admins)).toBe(
      false,
    );
    expect(
      isAdminEmail({ email: 'khach@rong.vn', emailVerified: true }, admins),
    ).toBe(false);
  });
});
