import { Inject, Injectable } from '@nestjs/common';
import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

import type { OAuthConfig } from '../../../config/configuration.js';
import {
  externalTokenInvalid,
  OAUTH_CONFIG,
  providerNotConfigured,
  providerUnavailable,
  type ExternalIdentity,
} from './external-identity.js';

/** Lỗi do chính token (chữ ký, hạn, aud/iss, định dạng, không có khóa khớp kid). */
const TOKEN_ERRORS = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JWKSNoMatchingKey,
  errors.JWKSMultipleMatchingKeys,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
];

/** Bộ khóa công khai của Google (token DI, để test thay bằng khóa tự tạo). */
export const GOOGLE_JWKS = 'GOOGLE_JWKS';

/** `jose` tự cache và tự tải lại khi Google xoay khóa. */
export function googleJwks(): JWTVerifyGetKey {
  return createRemoteJWKSet(
    new URL('https://www.googleapis.com/oauth2/v3/certs'),
    { timeoutDuration: 5000 },
  );
}

/**
 * Xác minh ID token do Google Sign-In trên app cấp (spec §2.2). Đây là Google
 * Identity, không phải Google Maps Platform: không vướng PRD §7.4.
 */
@Injectable()
export class GoogleIdTokenVerifier {
  constructor(
    @Inject(OAUTH_CONFIG) private readonly config: OAuthConfig,
    @Inject(GOOGLE_JWKS) private readonly jwks: JWTVerifyGetKey,
  ) {}

  async verify(idToken: string): Promise<ExternalIdentity> {
    if (this.config.googleClientIds.length === 0) {
      throw providerNotConfigured('Google');
    }
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.jwks, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: this.config.googleClientIds,
        algorithms: ['RS256'],
      }));
    } catch (error) {
      // Chỉ lỗi của chính token là 401. Còn lại (mạng, timeout, trang khóa trả HTTP lỗi hay JSON
      // hỏng — jose ném JOSEError trơn hoặc JWKSInvalid) là Google không phản hồi.
      if (TOKEN_ERRORS.some((type) => error instanceof type)) {
        throw externalTokenInvalid();
      }
      throw providerUnavailable('Google');
    }
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw externalTokenInvalid();
    }
    const email =
      typeof payload.email === 'string'
        ? payload.email.trim().toLowerCase()
        : null;
    // Google chỉ bảo đảm email còn thuộc người này với Gmail hoặc tài khoản Workspace (có `hd`).
    // Tài khoản Google dùng email ngoài: email đã xác minh lúc tạo, nhưng tên miền có thể đã đổi chủ.
    const trustedDomain =
      email?.endsWith('@gmail.com') ||
      (typeof payload.hd === 'string' && payload.hd !== '');
    const verified =
      trustedDomain &&
      (payload.email_verified === true || payload.email_verified === 'true');
    const name =
      typeof payload.name === 'string' && payload.name.trim()
        ? payload.name.trim()
        : null;
    return {
      provider: 'google',
      accountId: payload.sub,
      email,
      emailVerified: email !== null && verified,
      displayName: name,
    };
  }
}
