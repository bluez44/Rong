import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Header `X-Admin-Key` khớp `ADMIN_API_KEY`. So SHA-256 của hai chuỗi bằng `timingSafeEqual`: độ dài luôn bằng
 * nhau nên thời gian so không lộ khóa đúng được bao nhiêu ký tự, kể cả độ dài.
 */
export function keyMatches(
  presented: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof presented !== 'string' || presented === '') return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

/** Admin = email đã xác minh nằm trong `ADMIN_EMAILS` (đã viết thường). */
export function isAdminEmail(
  user: { email: string | null; emailVerified: boolean },
  adminEmails: readonly string[],
): boolean {
  return (
    !!user.email &&
    user.emailVerified &&
    adminEmails.includes(user.email.trim().toLowerCase())
  );
}
