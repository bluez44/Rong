/** Kiểm tra phía client, khớp với DTO của backend (auth.dto.ts) để báo lỗi trước khi gửi. */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_DISPLAY_NAME_LENGTH = 60;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (!value) return 'Nhập email của bạn.';
  if (value.length > 254 || !EMAIL_PATTERN.test(value)) return 'Email không hợp lệ. Kiểm tra lại dấu @ và tên miền.';
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Mật khẩu phải dài ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Mật khẩu dài tối đa ${MAX_PASSWORD_LENGTH} ký tự.`;
  return null;
}
