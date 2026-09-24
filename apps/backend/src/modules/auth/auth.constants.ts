export const AUTH_CONFIG = 'AUTH_CONFIG';

/** Nội dung access token. Không nhét email hay tên: chúng đổi được, còn token thì sống tới khi hết hạn. */
export interface AccessTokenPayload {
  sub: string;
}

/** Thứ `JwtStrategy` gắn vào `request.user` cho các route đã xác thực. */
export interface AuthUser {
  userId: string;
}
