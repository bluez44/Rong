import {
  BadGatewayException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

/** Cấu hình đăng nhập Google/Zalo (token DI). */
export const OAUTH_CONFIG = 'OAUTH_CONFIG';

/** Danh tính đã được nhà cung cấp xác minh, trước khi gắn vào tài khoản Rong. */
export interface ExternalIdentity {
  provider: 'google' | 'zalo';
  /** `sub` của Google; id Zalo (riêng theo app). */
  accountId: string;
  /** Đã chuẩn hóa chữ thường; Zalo luôn null. */
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

export function externalTokenInvalid(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: 'EXTERNAL_TOKEN_INVALID',
    message: 'Không xác minh được tài khoản. Hãy đăng nhập lại.',
  });
}

export function providerNotConfigured(
  name: string,
): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: 'PROVIDER_NOT_CONFIGURED',
    message: `Đăng nhập bằng ${name} chưa được bật.`,
  });
}

export function providerUnavailable(name: string): BadGatewayException {
  return new BadGatewayException({
    statusCode: 502,
    code: 'PROVIDER_UNAVAILABLE',
    message: `${name} đang không phản hồi. Thử lại sau ít phút.`,
  });
}
