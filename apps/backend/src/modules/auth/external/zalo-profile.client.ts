import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { OAuthConfig } from '../../../config/configuration.js';
import {
  externalTokenInvalid,
  OAUTH_CONFIG,
  providerNotConfigured,
  providerUnavailable,
  type ExternalIdentity,
} from './external-identity.js';

/** `fetch` dùng để gọi Zalo (token DI, để test thay được). */
export const ZALO_FETCH = 'ZALO_FETCH';

const PROFILE_URL = 'https://graph.zalo.me/v2.0/me?fields=id,name';
const TIMEOUT_MS = 5000;

/** HMAC-SHA256(access token, Secret Key), hex: Zalo từ chối token không cấp cho app có secret này. */
export function zaloAppSecretProof(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

/**
 * Đọc id và tên người dùng Zalo từ access token do SDK trên app cấp (spec
 * §2.2). Id Zalo riêng theo app, Zalo không trả email.
 */
@Injectable()
export class ZaloProfileClient {
  constructor(
    @Inject(OAUTH_CONFIG) private readonly config: OAuthConfig,
    @Inject(ZALO_FETCH) private readonly fetchImpl: typeof fetch,
  ) {}

  async fetch(accessToken: string): Promise<ExternalIdentity> {
    const { zaloAppId, zaloAppSecret } = this.config;
    if (!zaloAppId || !zaloAppSecret) throw providerNotConfigured('Zalo');

    let res: Response;
    try {
      res = await this.fetchImpl(PROFILE_URL, {
        headers: {
          access_token: accessToken,
          appsecret_proof: zaloAppSecretProof(accessToken, zaloAppSecret),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw providerUnavailable('Zalo');
    }
    if (res.status >= 500) throw providerUnavailable('Zalo');

    const body = (await res.json().catch(() => null)) as {
      id?: unknown;
      name?: unknown;
      error?: unknown;
    } | null;
    // Zalo báo lỗi token/proof trong JSON (error ≠ 0) kể cả khi HTTP 200.
    if (!res.ok || !body || (body.error !== undefined && body.error !== 0)) {
      throw externalTokenInvalid();
    }
    if (typeof body.id !== 'string' || body.id === '') {
      throw externalTokenInvalid();
    }
    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : null;
    return {
      provider: 'zalo',
      accountId: body.id,
      email: null,
      emailVerified: false,
      displayName: name,
    };
  }
}
