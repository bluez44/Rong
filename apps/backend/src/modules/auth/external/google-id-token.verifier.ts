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
      // Lỗi của chính token (chữ ký, hạn, aud, định dạng) là JOSEError; còn lại là mạng/timeout.
      if (
        error instanceof errors.JOSEError &&
        !(error instanceof errors.JWKSTimeout)
      ) {
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
    const verified =
      payload.email_verified === true || payload.email_verified === 'true';
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
