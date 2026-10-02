import { createHash, randomBytes } from 'node:crypto';

/**
 * Token của link mời và link xem: 32 byte ngẫu nhiên, base64url. Database chỉ
 * lưu SHA-256 — lộ database không lộ link dùng được. Không cần salt hay so
 * sánh hằng thời gian: token đủ entropy để không thể dò, và tra bằng bản băm.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Chặn chuỗi rác trước khi chạm database. */
export function isTokenShape(token: string): boolean {
  return TOKEN_SHAPE.test(token);
}
