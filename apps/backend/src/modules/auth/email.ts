/**
 * Chuẩn hóa email ở tầng ứng dụng thay vì dùng extension citext: một quy tắc
 * nằm trong code thì đọc được và test được.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
