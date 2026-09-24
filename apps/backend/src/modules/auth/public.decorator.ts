import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mọi route mặc định đều cần access token hợp lệ (JwtAuthGuard gắn toàn cục).
 * Chỉ các route xác thực — đăng ký, đăng nhập, xác minh email, sau này là quên
 * mật khẩu — được đánh dấu `@Public()`.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
