# Đăng nhập Google và Zalo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng app Android đăng nhập/đăng ký Rong bằng một chạm qua Google (ID token) hoặc Zalo (access token), nhận cùng loại phiên như đăng nhập mật khẩu.

**Architecture:** Mobile dùng SDK native (`@react-native-google-signin/google-signin`, `react-native-zalo-kit`) lấy token rồi gửi `POST /api/auth/google` hoặc `/api/auth/zalo`. Backend xác minh token qua một class riêng cho mỗi nhà cung cấp (`modules/auth/external/`), rồi `AuthService.loginExternal` tìm / gộp theo email (chỉ Google, chỉ email đã xác minh) / tạo tài khoản và cấp token bằng `issueTokens` sẵn có.

**Tech Stack:** NestJS 12 + TypeORM + Postgres, `jose` (mới), vitest; Expo SDK 57 / RN 0.86, Jest + `jest-expo` + React Native Testing Library (mới).

**Spec:** `docs/superpowers/specs/2026-10-21-google-zalo-login-design.md`

**Lệch so với spec (đã cân nhắc):**
- Spec §2.3 đặt tên `ExternalLoginService`. Plan đặt logic vào `AuthService.loginExternal` để dùng thẳng `issueTokens`/`signAccessToken` private hiện có, không phải tách hay nhân bản chúng. Hành vi giữ nguyên.
- Spec §4 muốn unit test ba nhánh gộp/tạo. Plan kiểm ba nhánh đó bằng e2e trên database thật (Task 3), vì logic là SQL trong transaction; mock `EntityManager` chỉ kiểm lại chính mock.
- Spec §1 nói migration đặt `transaction = false`. Không cần: Postgres ≥ 12 cho `ALTER TYPE … ADD VALUE` trong transaction (chỉ không được dùng giá trị mới trong cùng transaction), và Neon chạy Postgres ≥ 16.

## Global Constraints

- Comment, log, chuỗi lỗi, chữ UI bằng tiếng Việt.
- Backend ESM: import tương đối có đuôi `.js`.
- Lỗi backend dạng `{ statusCode, code, message }`. Mã mới: `EXTERNAL_TOKEN_INVALID` (401), `PROVIDER_NOT_CONFIGURED` (503), `PROVIDER_UNAVAILABLE` (502).
- Chỉ gộp tài khoản khi `provider = 'google'` **và** `email_verified = true`. Không bao giờ gộp với Zalo.
- `users.display_name` lấy tên nhà cung cấp chỉ khi tạo user mới, cắt còn ≤ 60 ký tự; không ghi đè về sau.
- Không ghi token (ID token, access token Zalo) vào log.
- Env đều không bắt buộc: `GOOGLE_OAUTH_CLIENT_IDS` (phẩy), `ZALO_APP_ID`, `ZALO_APP_SECRET` (backend); `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `ZALO_APP_ID` (mobile). Thiếu → nhà cung cấp đó tắt (backend 503, mobile ẩn nút).
- Timeout gọi Zalo Graph API: 5 s.
- **Chạy migration lên database dev (Neon) phải hỏi người dùng trước** (`pnpm migration:run`). e2e Task 3 cần migration đã chạy.
- Mobile: tuân `apps/mobile/CLAUDE.md`. Bỏ nút Apple.
- Commit nhỏ, mỗi task ít nhất một commit; message kết thúc bằng dòng attribution của phiên.

## Review Focus

1. **Email Google khác hoa/thường hoặc có khoảng trắng so với email đã đăng ký** (`An@Gmail.com` vs `an@gmail.com`) — vẫn phải gộp đúng tài khoản. → e2e "gộp không phân biệt hoa thường" ở Task 3.
2. **Tài khoản đã có danh tính Google rồi đăng nhập Google lần nữa với email đổi khác** — vào đúng user theo `sub`, không tạo user mới, không gộp sang user khác theo email mới. → e2e "đã có danh tính thì theo sub, bỏ qua email" ở Task 3.
3. **Tên từ nhà cung cấp rỗng hoặc rất dài** (Zalo cho tên 100 ký tự, Google không có `name`) — tạo user được, tên ≤ 60 ký tự hoặc null. → e2e "tên dài bị cắt, thiếu tên thì null" ở Task 3.
4. **Zalo trả HTTP 200 nhưng `error` khác 0, hoặc trả JSON không có `id`** — phải là 401, không tạo user với id rỗng. → unit test ở Task 2.
5. **Người dùng bấm Google rồi Zalo liên tiếp (hai luồng chồng nhau)** — nút thứ hai bị khóa khi một luồng đang chạy, chỉ một phiên được lưu. → test component `OAuthButtons` ở Task 6.

---

## File Structure

| File | Trách nhiệm |
| --- | --- |
| `apps/backend/src/modules/auth/external/external-identity.ts` (mới) | Kiểu `ExternalIdentity` + 3 hàm tạo lỗi |
| `apps/backend/src/modules/auth/external/google-id-token.verifier.ts` (mới) + `.spec.ts` | Xác minh ID token Google bằng `jose` |
| `apps/backend/src/modules/auth/external/zalo-profile.client.ts` (mới) + `.spec.ts` | Gọi Graph API Zalo với `appsecret_proof` |
| `apps/backend/src/config/configuration.ts`, `.env.example` | `OAuthConfig` |
| `apps/backend/src/database/migrations/1792400000000-AddZaloAuthProvider.ts` (mới) | Thêm `'zalo'` vào enum |
| `apps/backend/src/modules/auth/entities/auth-identity.entity.ts` | `AUTH_PROVIDERS` thêm `'zalo'` |
| `apps/backend/src/modules/auth/auth.service.ts` | `loginExternal` |
| `apps/backend/src/modules/auth/auth.controller.ts`, `dto/auth.dto.ts`, `auth.module.ts` | Endpoint, DTO, provider |
| `apps/backend/test/social-login.e2e-spec.ts` (mới) | e2e |
| `packages/shared-types/src/auth.ts` | `GoogleLoginRequest`, `ZaloLoginRequest` |
| `apps/mobile/jest.config.js`, `package.json` | Jest |
| `apps/mobile/src/lib/share-link.test.ts` (mới) | Test đầu tiên, chứng minh Jest chạy |
| `apps/mobile/src/lib/oauth.ts` (mới) + `.test.ts` | Gói 2 SDK |
| `apps/mobile/src/auth/auth-context.tsx` + `auth-context.test.tsx` (mới) | `loginWithGoogle`, `loginWithZalo`, signOut |
| `apps/mobile/src/components/oauth-buttons.tsx` (mới) + `.test.tsx` | Nút dùng chung |
| `apps/mobile/src/app/(auth)/login.tsx`, `register.tsx` | Thay `OAuthPlaceholder` |
| `apps/mobile/app.config.ts`, `.env.example` | Plugin + env |
| `apps/backend/src/modules/README.md`, `CLAUDE.md` | Tài liệu |

---

### Task 1: Backend — lỗi chung, cấu hình OAuth, xác minh ID token Google

**Files:**
- Create: `apps/backend/src/modules/auth/external/external-identity.ts`
- Create: `apps/backend/src/modules/auth/external/google-id-token.verifier.ts`
- Test: `apps/backend/src/modules/auth/external/google-id-token.verifier.spec.ts`
- Modify: `apps/backend/src/config/configuration.ts`, `apps/backend/.env.example`, `apps/backend/package.json` (thêm `jose`)

**Interfaces:**
- Produces:
  - `interface ExternalIdentity { provider: 'google' | 'zalo'; accountId: string; email: string | null; emailVerified: boolean; displayName: string | null }`
  - `externalTokenInvalid(): UnauthorizedException`, `providerNotConfigured(name: string): ServiceUnavailableException`, `providerUnavailable(name: string): BadGatewayException`
  - `interface OAuthConfig { googleClientIds: string[]; zaloAppId: string | null; zaloAppSecret: string | null }`, `AppConfig['oauth']`
  - `OAUTH_CONFIG = 'OAUTH_CONFIG'`, `GOOGLE_JWKS = 'GOOGLE_JWKS'` (token DI, export từ `google-id-token.verifier.ts` / `external-identity.ts`)
  - `class GoogleIdTokenVerifier { verify(idToken: string): Promise<ExternalIdentity> }`

- [ ] **Step 1: Cài `jose`**

Run: `pnpm --filter @rong/backend add jose`
Expected: `jose` xuất hiện trong `dependencies` của `apps/backend/package.json`.

- [ ] **Step 2: Lỗi chung và kiểu danh tính**

```ts
// apps/backend/src/modules/auth/external/external-identity.ts
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

export function providerNotConfigured(name: string): ServiceUnavailableException {
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
```

- [ ] **Step 3: Cấu hình**

Trong `configuration.ts`:

1. Cạnh `ShareLinksConfig` thêm:

```ts
/** Đăng nhập Google / Zalo (spec 2026-10-21-google-zalo-login). Thiếu giá trị = tắt nhà cung cấp đó. */
export interface OAuthConfig {
  /** Client ID được chấp nhận làm `aud` của ID token Google (Web client). */
  googleClientIds: string[];
  zaloAppId: string | null;
  zaloAppSecret: string | null;
}
```

2. `AppConfig` thêm `oauth: OAuthConfig;` (sau `shareLinks`).
3. Trong object trả về của `loadConfig`, sau `shareLinks`:

```ts
    oauth: {
      googleClientIds: (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      zaloAppId: process.env.ZALO_APP_ID || null,
      zaloAppSecret: process.env.ZALO_APP_SECRET || null,
    },
```

4. `apps/backend/.env.example`, cuối file:

```
# Đăng nhập Google / Zalo (docs/superpowers/specs/2026-10-21-google-zalo-login-design.md §7).
# Trống = tắt nhà cung cấp đó (endpoint trả 503).
# Web Client ID của Google Cloud, phân tách bằng dấu phẩy nếu nhiều.
GOOGLE_OAUTH_CLIENT_IDS=
# Zalo for Developers. Secret Key chỉ đặt ở backend.
ZALO_APP_ID=
ZALO_APP_SECRET=
```

- [ ] **Step 4: Viết test thất bại cho verifier**

```ts
// apps/backend/src/modules/auth/external/google-id-token.verifier.spec.ts
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { GoogleIdTokenVerifier } from './google-id-token.verifier.js';

const CLIENT_ID = 'rong-web.apps.googleusercontent.com';
let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  jwks = createLocalJWKSet({ keys: [jwk] });
});

function sign(claims: Record<string, unknown>, opts: { aud?: string; iss?: string; exp?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? 'https://accounts.google.com')
    .setAudience(opts.aud ?? CLIENT_ID)
    .setSubject('google-sub-1')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '10m')
    .sign(privateKey);
}

const verifier = (clientIds = [CLIENT_ID]) =>
  new GoogleIdTokenVerifier(
    { googleClientIds: clientIds, zaloAppId: null, zaloAppSecret: null },
    jwks,
  );

describe('GoogleIdTokenVerifier', () => {
  it('token hợp lệ → danh tính với email chữ thường', async () => {
    const token = await sign({ email: 'An@Gmail.com', email_verified: true, name: 'An' });
    await expect(verifier().verify(token)).resolves.toEqual({
      provider: 'google',
      accountId: 'google-sub-1',
      email: 'an@gmail.com',
      emailVerified: true,
      displayName: 'An',
    });
  });

  it('email_verified dạng chuỗi "true" vẫn tính là đã xác minh; thiếu name thì null', async () => {
    const token = await sign({ email: 'b@gmail.com', email_verified: 'true' });
    const identity = await verifier().verify(token);
    expect(identity.emailVerified).toBe(true);
    expect(identity.displayName).toBeNull();
  });

  it('sai aud, sai iss, hết hạn, chuỗi rác → EXTERNAL_TOKEN_INVALID', async () => {
    const bad = [
      await sign({}, { aud: 'app-khac' }),
      await sign({}, { iss: 'https://evil.example' }),
      await sign({}, { exp: '-1m' }),
      'khong-phai-jwt',
    ];
    for (const token of bad) {
      await expect(verifier().verify(token)).rejects.toMatchObject({
        response: { code: 'EXTERNAL_TOKEN_INVALID' },
      });
    }
  });

  it('chưa cấu hình Client ID → PROVIDER_NOT_CONFIGURED', async () => {
    const token = await sign({});
    await expect(verifier([]).verify(token)).rejects.toMatchObject({
      response: { code: 'PROVIDER_NOT_CONFIGURED' },
    });
  });

  it('không tải được khóa của Google → PROVIDER_UNAVAILABLE', async () => {
    const token = await sign({});
    const failing: JWTVerifyGetKey = () => Promise.reject(new TypeError('fetch failed'));
    const v = new GoogleIdTokenVerifier(
      { googleClientIds: [CLIENT_ID], zaloAppId: null, zaloAppSecret: null },
      failing,
    );
    await expect(v.verify(token)).rejects.toMatchObject({
      response: { code: 'PROVIDER_UNAVAILABLE' },
    });
  });
});
```

Run: `cd apps/backend && npx vitest run src/modules/auth/external/google-id-token.verifier.spec.ts`
Expected: FAIL — không tìm thấy `./google-id-token.verifier.js`.

- [ ] **Step 5: Viết verifier**

```ts
// apps/backend/src/modules/auth/external/google-id-token.verifier.ts
import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

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
  return createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), {
    timeoutDuration: 5000,
  });
}

/**
 * Xác minh ID token do Google Sign-In trên app cấp (spec §2.2). Đây là Google Identity, không phải
 * Google Maps Platform: không vướng PRD §7.4.
 */
@Injectable()
export class GoogleIdTokenVerifier {
  constructor(
    @Inject(OAUTH_CONFIG) private readonly config: OAuthConfig,
    @Inject(GOOGLE_JWKS) private readonly jwks: JWTVerifyGetKey,
  ) {}

  async verify(idToken: string): Promise<ExternalIdentity> {
    if (this.config.googleClientIds.length === 0) throw providerNotConfigured('Google');
    let payload;
    try {
      ({ payload } = await jwtVerify(idToken, this.jwks, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: this.config.googleClientIds,
        algorithms: ['RS256'],
      }));
    } catch (error) {
      // Lỗi của chính token (chữ ký, hạn, aud, định dạng) là JOSEError; còn lại là mạng/timeout.
      if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) {
        throw externalTokenInvalid();
      }
      throw providerUnavailable('Google');
    }
    if (typeof payload.sub !== 'string' || payload.sub === '') throw externalTokenInvalid();
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null;
    const verified = payload.email_verified === true || payload.email_verified === 'true';
    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null;
    return {
      provider: 'google',
      accountId: payload.sub,
      email,
      emailVerified: email !== null && verified,
      displayName: name,
    };
  }
}
```

- [ ] **Step 6: Chạy test, phải PASS**

Run: `cd apps/backend && npx vitest run src/modules/auth/external/google-id-token.verifier.spec.ts`
Expected: 5 test PASS. Nếu test "chuỗi rác" ném lỗi không phải `JOSEError`, xem lỗi `jose` thực tế ném rồi sửa điều kiện trong `catch` (không sửa test).

- [ ] **Step 7: Typecheck, lint, commit**

Run: `cd apps/backend && pnpm typecheck && pnpm lint`
Expected: không lỗi mới.

```bash
git add apps/backend/package.json pnpm-lock.yaml apps/backend/src/modules/auth/external apps/backend/src/config/configuration.ts apps/backend/.env.example
git commit -m "feat(backend): verify Google ID tokens for sign-in"
```

---

### Task 2: Backend — client Graph API Zalo

**Files:**
- Create: `apps/backend/src/modules/auth/external/zalo-profile.client.ts`
- Test: `apps/backend/src/modules/auth/external/zalo-profile.client.spec.ts`

**Interfaces:**
- Consumes: `ExternalIdentity`, `OAUTH_CONFIG`, `externalTokenInvalid`, `providerNotConfigured`, `providerUnavailable`, `OAuthConfig` (Task 1).
- Produces: `class ZaloProfileClient { fetch(accessToken: string): Promise<ExternalIdentity> }`; `ZALO_FETCH = 'ZALO_FETCH'` (token DI, kiểu `typeof fetch`); `zaloAppSecretProof(token: string, secret: string): string`.

- [ ] **Step 1: Viết test thất bại**

```ts
// apps/backend/src/modules/auth/external/zalo-profile.client.spec.ts
import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ZaloProfileClient, zaloAppSecretProof } from './zalo-profile.client.js';

const CONFIG = { googleClientIds: [], zaloAppId: '123', zaloAppSecret: 'bi-mat' };

function client(response: () => Promise<Response>, config = CONFIG) {
  const fetchImpl = vi.fn(response);
  return { fetchImpl, zalo: new ZaloProfileClient(config, fetchImpl as unknown as typeof fetch) };
}
const json = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status });

describe('ZaloProfileClient', () => {
  it('gửi access_token và appsecret_proof đúng HMAC, trả danh tính không có email', async () => {
    const { fetchImpl, zalo } = client(json(200, { id: '987', name: 'Bình' }));
    await expect(zalo.fetch('tok')).resolves.toEqual({
      provider: 'zalo',
      accountId: '987',
      email: null,
      emailVerified: false,
      displayName: 'Bình',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.zalo.me/v2.0/me?fields=id,name');
    expect(init.headers).toMatchObject({
      access_token: 'tok',
      appsecret_proof: createHmac('sha256', 'bi-mat').update('tok').digest('hex'),
    });
    expect(zaloAppSecretProof('tok', 'bi-mat')).toBe(
      createHmac('sha256', 'bi-mat').update('tok').digest('hex'),
    );
  });

  it('HTTP 200 nhưng error khác 0 → EXTERNAL_TOKEN_INVALID', async () => {
    const { zalo } = client(json(200, { error: 452, message: 'Access token is invalid' }));
    await expect(zalo.fetch('tok')).rejects.toMatchObject({
      response: { code: 'EXTERNAL_TOKEN_INVALID' },
    });
  });

  it('không có id → EXTERNAL_TOKEN_INVALID', async () => {
    const { zalo } = client(json(200, { name: 'Không id' }));
    await expect(zalo.fetch('tok')).rejects.toMatchObject({
      response: { code: 'EXTERNAL_TOKEN_INVALID' },
    });
  });

  it('HTTP 5xx hoặc lỗi mạng → PROVIDER_UNAVAILABLE', async () => {
    for (const response of [json(503, {}), () => Promise.reject(new TypeError('fetch failed'))]) {
      const { zalo } = client(response);
      await expect(zalo.fetch('tok')).rejects.toMatchObject({
        response: { code: 'PROVIDER_UNAVAILABLE' },
      });
    }
  });

  it('thiếu App ID hoặc Secret → PROVIDER_NOT_CONFIGURED, không gọi mạng', async () => {
    const { fetchImpl, zalo } = client(json(200, { id: '1' }), { ...CONFIG, zaloAppSecret: null });
    await expect(zalo.fetch('tok')).rejects.toMatchObject({
      response: { code: 'PROVIDER_NOT_CONFIGURED' },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
```

Run: `cd apps/backend && npx vitest run src/modules/auth/external/zalo-profile.client.spec.ts`
Expected: FAIL — không tìm thấy module.

- [ ] **Step 2: Viết client**

```ts
// apps/backend/src/modules/auth/external/zalo-profile.client.ts
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
 * Đọc id và tên người dùng Zalo từ access token do SDK trên app cấp (spec §2.2). Id Zalo riêng theo
 * app, Zalo không trả email.
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

    const body = (await res.json().catch(() => null)) as
      | { id?: unknown; name?: unknown; error?: unknown }
      | null;
    // Zalo báo lỗi token/proof trong JSON (error ≠ 0) kể cả khi HTTP 200.
    if (!res.ok || !body || (body.error !== undefined && body.error !== 0)) {
      throw externalTokenInvalid();
    }
    if (typeof body.id !== 'string' || body.id === '') throw externalTokenInvalid();
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
    return {
      provider: 'zalo',
      accountId: body.id,
      email: null,
      emailVerified: false,
      displayName: name,
    };
  }
}
```

- [ ] **Step 3: Chạy test, phải PASS**

Run: `cd apps/backend && npx vitest run src/modules/auth/external/zalo-profile.client.spec.ts`
Expected: 5 test PASS.

- [ ] **Step 4: Typecheck, lint, commit**

Run: `cd apps/backend && pnpm typecheck && pnpm lint`
Expected: không lỗi mới.

```bash
git add apps/backend/src/modules/auth/external
git commit -m "feat(backend): read Zalo profiles with appsecret_proof"
```

---

### Task 3: Backend — migration, `loginExternal`, endpoint, e2e, tài liệu

**Files:**
- Create: `apps/backend/src/database/migrations/1792400000000-AddZaloAuthProvider.ts`
- Modify: `apps/backend/src/modules/auth/entities/auth-identity.entity.ts:15` (`AUTH_PROVIDERS`)
- Modify: `apps/backend/src/modules/auth/auth.service.ts` (thêm `loginExternal`)
- Modify: `apps/backend/src/modules/auth/dto/auth.dto.ts`, `auth.controller.ts`, `auth.module.ts`
- Modify: `packages/shared-types/src/auth.ts`
- Test: `apps/backend/test/social-login.e2e-spec.ts`
- Modify: `apps/backend/src/modules/README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `GoogleIdTokenVerifier.verify`, `ZaloProfileClient.fetch`, `ExternalIdentity`, `OAUTH_CONFIG`, `GOOGLE_JWKS`, `googleJwks`, `ZALO_FETCH` (Task 1–2).
- Produces:
  - `POST /api/auth/google { idToken }` → `AuthTokens` (200); `POST /api/auth/zalo { accessToken }` → `AuthTokens` (200).
  - `AuthService.loginExternal(identity: ExternalIdentity): Promise<AuthTokens>`
  - shared-types: `interface GoogleLoginRequest { idToken: string }`, `interface ZaloLoginRequest { accessToken: string }`.

- [ ] **Step 1: Migration và enum**

```ts
// apps/backend/src/database/migrations/1792400000000-AddZaloAuthProvider.ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Đăng nhập bằng Zalo (spec 2026-10-21-google-zalo-login). */
export class AddZaloAuthProvider1792400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "auth_provider" ADD VALUE IF NOT EXISTS 'zalo'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres không xóa được giá trị khỏi enum; để nguyên 'zalo' không ảnh hưởng gì.
  }
}
```

`auth-identity.entity.ts`: `export const AUTH_PROVIDERS = ['password', 'google', 'apple', 'zalo'] as const;` và sửa comment lớp: `Thêm nhà cung cấp ngoài (Google, Zalo) là insert một dòng trỏ về cùng user_id — xem AuthService.loginExternal.`

**Hỏi người dùng trước khi chạy** (`.env` trỏ tới Neon dev): `cd apps/backend && pnpm migration:run`.
Expected: log có `AddZaloAuthProvider1792400000000` đã chạy.

- [ ] **Step 2: Kiểu chung**

`packages/shared-types/src/auth.ts`, cuối file:

```ts
/** POST /auth/google — ID token từ Google Sign-In trên app. */
export interface GoogleLoginRequest {
  idToken: string;
}

/** POST /auth/zalo — access token từ Zalo SDK trên app. */
export interface ZaloLoginRequest {
  accessToken: string;
}
```

Run: `pnpm --filter @rong/backend build:deps`
Expected: build shared-types thành công.

- [ ] **Step 3: Viết e2e thất bại**

```ts
// apps/backend/test/social-login.e2e-spec.ts
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import {
  externalTokenInvalid,
  providerNotConfigured,
  type ExternalIdentity,
} from '../src/modules/auth/external/external-identity.js';
import { GoogleIdTokenVerifier } from '../src/modules/auth/external/google-id-token.verifier.js';
import { ZaloProfileClient } from '../src/modules/auth/external/zalo-profile.client.js';

/** Token giả → danh tính. Mỗi test tự đăng ký token của mình; token lạ → 401. */
const fakes = new Map<string, ExternalIdentity | 'not-configured'>();
const resolveFake = async (token: string) => {
  const found = fakes.get(token);
  if (found === 'not-configured') throw providerNotConfigured('Google');
  if (!found) throw externalTokenInvalid();
  return found;
};

describe('Đăng nhập Google / Zalo (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  const run = `${Date.now()}`;
  let n = 0;
  const uid = () => `e2e-social-${run}-${++n}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GoogleIdTokenVerifier)
      .useValue({ verify: resolveFake })
      .overrideProvider(ZaloProfileClient)
      .useValue({ fetch: resolveFake })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    // auth_identities và refresh_tokens xóa theo user (ON DELETE CASCADE).
    await db?.query(
      `DELETE FROM users WHERE id IN (
         SELECT user_id FROM auth_identities WHERE provider_account_id LIKE $1 OR email LIKE $2)`,
      [`e2e-social-${run}-%`, `e2e-social-${run}-%`],
    );
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const google = (idToken: string) => http().post('/api/auth/google').send({ idToken });
  const zalo = (accessToken: string) => http().post('/api/auth/zalo').send({ accessToken });

  function googleIdentity(over: Partial<ExternalIdentity> = {}): ExternalIdentity {
    const id = uid();
    return {
      provider: 'google',
      accountId: id,
      email: `${id}@gmail.test`,
      emailVerified: true,
      displayName: 'Người Google',
      ...over,
    };
  }

  /** Tài khoản email + mật khẩu, mặc định chưa xác minh email. */
  async function passwordAccount(email: string, verified = false) {
    const [user] = (await db.query(
      `INSERT INTO users (display_name) VALUES ('Người cũ') RETURNING id`,
    )) as Array<{ id: string }>;
    await db.query(
      `INSERT INTO auth_identities (user_id, provider, provider_account_id, email, email_verified_at, password_hash)
       VALUES ($1, 'password', $2, $2, ${verified ? 'now()' : 'NULL'}, $3)`,
      [user.id, email, await app.get(PasswordService).hash('mat-khau-e2e-du-dai')],
    );
    return user.id;
  }

  it('Google lần đầu tạo user, lần hai vào lại đúng user', async () => {
    const identity = googleIdentity();
    fakes.set('g-first', identity);
    const first = await google('g-first').expect(200);
    expect(first.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: { displayName: 'Người Google', email: identity.email, emailVerified: true },
    });
    const second = await google('g-first').expect(200);
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it('gộp vào tài khoản mật khẩu cùng email (không phân biệt hoa thường) và xác minh email của nó', async () => {
    const email = `${uid()}@gmail.test`;
    const userId = await passwordAccount(email);
    fakes.set('g-merge', googleIdentity({ email }));
    const res = await google('g-merge').expect(200);
    expect(res.body.user).toMatchObject({ id: userId, displayName: 'Người cũ', emailVerified: true });
    // Danh tính mật khẩu giờ đã xác minh: đăng nhập bằng mật khẩu được.
    await http()
      .post('/api/auth/login')
      .send({ email: email.toUpperCase(), password: 'mat-khau-e2e-du-dai' })
      .expect(200);
  });

  it('không gộp khi Google chưa xác minh email', async () => {
    const email = `${uid()}@gmail.test`;
    const userId = await passwordAccount(email, true);
    fakes.set('g-unverified', googleIdentity({ email, emailVerified: false }));
    const res = await google('g-unverified').expect(200);
    expect(res.body.user.id).not.toBe(userId);
  });

  it('đã có danh tính thì theo sub, bỏ qua email mới', async () => {
    const identity = googleIdentity();
    fakes.set('g-sub-1', identity);
    const first = await google('g-sub-1').expect(200);
    const otherEmail = `${uid()}@gmail.test`;
    await passwordAccount(otherEmail, true);
    fakes.set('g-sub-2', { ...identity, email: otherEmail });
    const second = await google('g-sub-2').expect(200);
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it('Zalo tạo user không có email; tên dài bị cắt, thiếu tên thì null', async () => {
    fakes.set('z-long', {
      provider: 'zalo',
      accountId: uid(),
      email: null,
      emailVerified: false,
      displayName: 'Z'.repeat(100),
    });
    const res = await zalo('z-long').expect(200);
    expect(res.body.user).toMatchObject({ email: null, emailVerified: false });
    expect(res.body.user.displayName).toHaveLength(60);
    const me = await http()
      .get('/api/users/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBeNull();

    fakes.set('z-noname', { provider: 'zalo', accountId: uid(), email: null, emailVerified: false, displayName: null });
    expect((await zalo('z-noname').expect(200)).body.user.displayName).toBeNull();
  });

  it('Zalo không bao giờ gộp theo email', async () => {
    // Zalo không có email; dù danh tính giả có email cũng không được gộp.
    const email = `${uid()}@gmail.test`;
    const userId = await passwordAccount(email, true);
    fakes.set('z-email', { provider: 'zalo', accountId: uid(), email, emailVerified: true, displayName: null });
    expect((await zalo('z-email').expect(200)).body.user.id).not.toBe(userId);
  });

  it('hai lần đăng nhập đầu tiên đồng thời cùng sub → cùng user, không 500', async () => {
    fakes.set('g-race', googleIdentity());
    const [a, b] = await Promise.all([google('g-race'), google('g-race')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.user.id).toBe(b.body.user.id);
  });

  it('token sai → 401; chưa cấu hình → 503; body thiếu → 400', async () => {
    expect((await google('khong-ai-biet').expect(401)).body.code).toBe('EXTERNAL_TOKEN_INVALID');
    fakes.set('g-off', 'not-configured');
    expect((await google('g-off').expect(503)).body.code).toBe('PROVIDER_NOT_CONFIGURED');
    await http().post('/api/auth/google').send({}).expect(400);
    await http().post('/api/auth/zalo').send({ accessToken: 1 }).expect(400);
  });

  it('xóa tài khoản xóa luôn danh tính; đăng nhập lại tạo user mới', async () => {
    fakes.set('g-delete', googleIdentity());
    const first = await google('g-delete').expect(200);
    await http()
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .expect((res) => expect([200, 204]).toContain(res.status));
    const again = await google('g-delete').expect(200);
    expect(again.body.user.id).not.toBe(first.body.user.id);
  });
});
```

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/social-login.e2e-spec.ts`
Expected: FAIL — module chưa đăng ký `GoogleIdTokenVerifier` (overrideProvider báo không có provider) hoặc route 404.

- [ ] **Step 4: DTO, controller, module**

`dto/auth.dto.ts`, cuối file:

```ts
export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  idToken!: string;
}

export class ZaloLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  accessToken!: string;
}
```

`auth.controller.ts`: import `GoogleLoginDto, ZaloLoginDto`, `GoogleIdTokenVerifier`, `ZaloProfileClient`; constructor thêm `private readonly google: GoogleIdTokenVerifier, private readonly zalo: ZaloProfileClient`; thêm sau `login` (controller đã gắn `@Public()` ở mức lớp nên hai route mới tự mở, không cần đăng nhập):

```ts
  /** Đăng nhập/đăng ký bằng Google (spec 2026-10-21-google-zalo-login). */
  @Post('google')
  @HttpCode(HttpStatus.OK)
  async loginWithGoogle(@Body() dto: GoogleLoginDto): Promise<AuthTokens> {
    return this.auth.loginExternal(await this.google.verify(dto.idToken));
  }

  /** Đăng nhập/đăng ký bằng Zalo. */
  @Post('zalo')
  @HttpCode(HttpStatus.OK)
  async loginWithZalo(@Body() dto: ZaloLoginDto): Promise<AuthTokens> {
    return this.auth.loginExternal(await this.zalo.fetch(dto.accessToken));
  }
```

`auth.module.ts`: thêm vào `providers`:

```ts
    GoogleIdTokenVerifier,
    ZaloProfileClient,
    {
      provide: OAUTH_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow<AppConfig['oauth']>('oauth'),
    },
    { provide: GOOGLE_JWKS, useFactory: googleJwks },
    { provide: ZALO_FETCH, useValue: fetch },
```

(import `OAUTH_CONFIG` từ `./external/external-identity.js`, `GoogleIdTokenVerifier, GOOGLE_JWKS, googleJwks` từ `./external/google-id-token.verifier.js`, `ZaloProfileClient, ZALO_FETCH` từ `./external/zalo-profile.client.js`.)

- [ ] **Step 5: `AuthService.loginExternal`**

Import thêm `type ExternalIdentity` từ `./external/external-identity.js`. Thêm hằng `const MAX_DISPLAY_NAME = 60;` cạnh `RESEND_COOLDOWN_MS`. Thêm method công khai sau `logout`:

```ts
  /**
   * Đăng nhập bằng danh tính nhà cung cấp đã xác minh (Google, Zalo):
   * 1. đã có danh tính này → user đó;
   * 2. Google, email đã xác minh, trùng email một danh tính khác → gộp vào user đó (và coi email
   *    của các danh tính trùng là đã xác minh);
   * 3. còn lại → user mới.
   * Hai lần đăng nhập đầu tiên đồng thời: bên thua đụng unique index thì chạy lại, lần này rơi vào (1).
   */
  async loginExternal(external: ExternalIdentity): Promise<AuthTokens> {
    try {
      return await this.findOrCreateExternal(external);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as { code?: string }).code === PG_UNIQUE_VIOLATION
      ) {
        return this.findOrCreateExternal(external);
      }
      throw error;
    }
  }

  private async findOrCreateExternal(
    external: ExternalIdentity,
  ): Promise<AuthTokens> {
    const email = external.email ? normalizeEmail(external.email) : null;
    const { user, identities } = await this.dataSource.transaction(
      async (manager) => {
        const existing = await manager.findOneBy(AuthIdentity, {
          provider: external.provider,
          providerAccountId: external.accountId,
        });
        let userId = existing?.userId;

        if (!userId) {
          const canMerge =
            external.provider === 'google' && external.emailVerified && email;
          if (canMerge) {
            const [match] = (await manager.query(
              `SELECT i.user_id FROM auth_identities i JOIN users u ON u.id = i.user_id
                WHERE i.email = $1 ORDER BY u.created_at LIMIT 1`,
              [email],
            )) as Array<{ user_id: string }>;
            userId = match?.user_id;
            if (userId) {
              // Google đã xác minh email này hộ: danh tính mật khẩu chưa xác minh giờ đăng nhập được.
              await manager.update(
                AuthIdentity,
                { userId, email, emailVerifiedAt: IsNull() },
                { emailVerifiedAt: new Date() },
              );
            }
          }
          if (!userId) {
            const created = await manager.save(
              manager.create(User, {
                displayName:
                  external.displayName?.slice(0, MAX_DISPLAY_NAME) || null,
              }),
            );
            userId = created.id;
          }
          await manager.save(
            manager.create(AuthIdentity, {
              userId,
              provider: external.provider,
              providerAccountId: external.accountId,
              email,
              emailVerifiedAt: email && external.emailVerified ? new Date() : null,
              passwordHash: null,
            }),
          );
        }

        await manager.update(User, userId, { lastSeenAt: new Date() });
        return {
          user: await manager.findOneByOrFail(User, { id: userId }),
          identities: await manager.findBy(AuthIdentity, { userId }),
        };
      },
    );
    return this.issueTokens(user, identities);
  }
```

Lưu ý: Zalo luôn có `email: null` từ `ZaloProfileClient`; test "Zalo không bao giờ gộp" truyền email giả để chứng minh điều kiện `provider === 'google'` giữ đúng. Khi đó danh tính Zalo được lưu kèm email đó — chấp nhận được vì chỉ xảy ra trong test.

- [ ] **Step 6: Chạy e2e, phải PASS**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/social-login.e2e-spec.ts`
Expected: 9 test PASS. Nếu `DELETE /api/users/me` trả mã khác 200/204, đọc `users.controller.ts` và sửa kỳ vọng cho đúng mã hiện có.

- [ ] **Step 7: Toàn bộ kiểm tra backend**

Run: `cd apps/backend && pnpm lint && pnpm typecheck && pnpm test && npx vitest run --config vitest.config.e2e.ts test/auth-refresh.e2e-spec.ts test/account.e2e-spec.ts`
Expected: sạch; unit và hai e2e auth cũ vẫn PASS.

- [ ] **Step 8: Tài liệu**

- `apps/backend/src/modules/README.md`, mục auth: thêm
  ```
  POST /api/auth/google { idToken }       đăng nhập/đăng ký bằng Google (ID token, aud ∈ GOOGLE_OAUTH_CLIENT_IDS)
  POST /api/auth/zalo   { accessToken }   đăng nhập/đăng ký bằng Zalo (Graph API + appsecret_proof)
  ```
  và một đoạn: gộp tài khoản chỉ khi Google + email đã xác minh, theo email; Zalo không có email, không gộp; thiếu env → 503 `PROVIDER_NOT_CONFIGURED`.
- `CLAUDE.md`, dòng "Login design": nối thêm `Google (ID token verified with jose) and Zalo (Graph API with appsecret_proof) sign in through POST /auth/google and /auth/zalo (modules/auth/external/); a verified Google email merges into the existing account with that email, Zalo never merges.` và cập nhật dòng "Open today" thêm hai route này (đã nằm dưới `auth/*`, chỉ cần ghi chú nếu dòng đó liệt kê cụ thể).

- [ ] **Step 9: Commit**

```bash
git add apps/backend packages/shared-types/src/auth.ts CLAUDE.md
git commit -m "feat(backend): sign in with Google and Zalo, merging verified Google emails"
```

---

### Task 4: Mobile — cài Jest, test đầu tiên

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/jest.config.js`
- Test: `apps/mobile/src/lib/share-link.test.ts`

**Interfaces:**
- Produces: `pnpm --filter @rong/mobile test` chạy Jest với preset `jest-expo`, alias `@/` → `src/`. Turbo `pnpm test` ở gốc chạy luôn mobile.

- [ ] **Step 1: Cài**

Run: `cd apps/mobile && npx expo install jest-expo jest @types/jest @testing-library/react-native -- -D`
Expected: bốn gói vào `devDependencies` với phiên bản Expo SDK 57 chọn.

Thêm script: `"test": "jest"`.

```js
// apps/mobile/jest.config.js
/** Jest cho app mobile: preset của Expo lo biên dịch và mock module native. */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
};
```

- [ ] **Step 2: Test đầu tiên (phải FAIL nếu logic sai — viết với một kỳ vọng sai trước để thấy Jest thật sự chạy)**

```ts
// apps/mobile/src/lib/share-link.test.ts
import { itineraryShareUrl, resolveShareToken } from './share-link';

describe('resolveShareToken', () => {
  it('người sửa được gọi PUT', async () => {
    const authFetch = jest.fn().mockResolvedValue({ token: 'tok', createdAt: '' });
    await expect(resolveShareToken(authFetch, 'trip-1', true)).resolves.toBe('tok');
    expect(authFetch).toHaveBeenCalledWith('/itineraries/trip-1/share-link', { method: 'PUT' });
  });

  it('người chỉ xem gọi GET; chưa có link thì null', async () => {
    const authFetch = jest.fn().mockResolvedValue({ link: null });
    await expect(resolveShareToken(authFetch, 'trip-1', false)).resolves.toBeNull();
    expect(authFetch).toHaveBeenCalledWith('/itineraries/trip-1/share-link');
  });

  it('người chỉ xem lấy được link có sẵn', async () => {
    const authFetch = jest.fn().mockResolvedValue({ link: { token: 'abc', createdAt: '' } });
    await expect(resolveShareToken(authFetch, 'trip-1', false)).resolves.toBe('abc');
  });

  it('URL web có dạng /t/<token>', () => {
    expect(itineraryShareUrl('abc')).toMatch(/\/t\/abc$/);
  });
});
```

Run: `cd apps/mobile && pnpm test`
Expected: 4 test PASS. Để chứng minh test có tác dụng: tạm đổi `'PUT'` trong kỳ vọng đầu thành `'POST'`, chạy lại → FAIL, rồi đổi lại → PASS.

- [ ] **Step 3: Typecheck, lint, commit**

Run: `cd apps/mobile && pnpm typecheck && pnpm lint`
Expected: typecheck sạch (`@types/jest` cho `describe`/`expect`); lint không lỗi mới.

```bash
git add apps/mobile/package.json apps/mobile/jest.config.js apps/mobile/src/lib/share-link.test.ts pnpm-lock.yaml
git commit -m "test(mobile): set up Jest with jest-expo"
```

---

### Task 5: Mobile — `lib/oauth.ts` và `auth-context`

**Files:**
- Modify: `apps/mobile/package.json` (2 SDK), `apps/mobile/app.config.ts`, `apps/mobile/.env.example`
- Create: `apps/mobile/src/lib/oauth.ts`
- Test: `apps/mobile/src/lib/oauth.test.ts`
- Modify: `apps/mobile/src/auth/auth-context.tsx`
- Test: `apps/mobile/src/auth/auth-context.test.tsx`

**Interfaces:**
- Consumes: `POST /auth/google`, `POST /auth/zalo` (Task 3); `GoogleLoginRequest`, `ZaloLoginRequest`.
- Produces:
  - `type OAuthResult = { kind: 'token'; token: string } | { kind: 'cancelled' } | { kind: 'unavailable'; message: string }`
  - `googleAvailable: boolean`, `zaloAvailable: boolean`
  - `signInWithGoogle(): Promise<OAuthResult>`, `signInWithZalo(): Promise<OAuthResult>`, `signOutProviders(): Promise<void>`
  - `useAuth()` thêm `loginWithGoogle(): Promise<OAuthResult['kind']>` và `loginWithZalo(): Promise<OAuthResult['kind']>` — trả `'token'` khi đã vào phiên, `'cancelled'`; ném `ApiError` hoặc `OAuthUnavailableError` (có `message`) khi lỗi.
  - `class OAuthUnavailableError extends Error` (export từ `lib/oauth.ts`).

- [ ] **Step 1: Cài SDK và cấu hình**

Run: `cd apps/mobile && npx expo install @react-native-google-signin/google-signin react-native-zalo-kit`
Expected: hai gói vào `dependencies`; `react-native-zalo-kit` ≥ 6.0.0.

`app.config.ts`:
- Trong `plugins`, thêm sau `'expo-secure-store'`:

```ts
    // Đăng nhập Google (spec 2026-10-21-google-zalo-login). Client ID truyền lúc chạy qua EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.
    '@react-native-google-signin/google-signin',
    // Đăng nhập Zalo: chỉ cấu hình native khi có ZALO_APP_ID.
    ...(process.env.ZALO_APP_ID ? [['react-native-zalo-kit', { appId: process.env.ZALO_APP_ID }] as [string, object]] : []),
```

- Trong `extra`, thêm `zaloAppId: process.env.ZALO_APP_ID ?? null,`.

`apps/mobile/.env.example`, cuối file:

```
# Đăng nhập Google: Web Client ID trên Google Cloud (spec 2026-10-21-google-zalo-login §7.A). Trống = ẩn nút.
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
# Đăng nhập Zalo: App ID trên developers.zalo.me (§7.B). Đọc lúc build; trống = ẩn nút.
ZALO_APP_ID=
```

- [ ] **Step 2: Xác định mã lỗi "người dùng hủy" của Zalo**

Đọc mã native của thư viện: `grep -rn "reject\|cancel" apps/mobile/node_modules/react-native-zalo-kit/android/src | head -40` (hoặc trong `node_modules` gốc vì `nodeLinker: hoisted`). Ghi lại mã/chuỗi lỗi khi người dùng bấm quay lại hoặc từ chối. Điền vào hằng `ZALO_CANCEL_CODES` ở Step 4. Nếu thư viện không phân biệt hủy với lỗi khác: để `ZALO_CANCEL_CODES` rỗng và coi lỗi có `message` khớp `/cancel|hủy|huỷ/i` là hủy; ghi quyết định này vào ledger.

- [ ] **Step 3: Viết test thất bại cho `oauth.ts`**

```ts
// apps/mobile/src/lib/oauth.test.ts
const mockGoogle = {
  configure: jest.fn(),
  hasPlayServices: jest.fn(),
  signIn: jest.fn(),
  signOut: jest.fn(),
};
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: mockGoogle,
  isSuccessResponse: (r: { type: string }) => r.type === 'success',
  isErrorWithCode: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  statusCodes: { PLAY_SERVICES_NOT_AVAILABLE: 'PLAY', IN_PROGRESS: 'IN_PROGRESS', SIGN_IN_CANCELLED: 'CANCEL' },
}));
const mockZalo = { login: jest.fn(), logout: jest.fn() };
jest.mock('react-native-zalo-kit', () => ({
  login: (...args: unknown[]) => mockZalo.login(...args),
  logout: () => mockZalo.logout(),
  Constants: { AUTH_VIA_APP_OR_WEB: 'app_or_web' },
}));
jest.mock('expo-constants', () => ({ expoConfig: { extra: { zaloAppId: '123' } } }));

describe('oauth', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-client';
  });
  const load = () => require('./oauth') as typeof import('./oauth');

  it('Google thành công → idToken', async () => {
    mockGoogle.hasPlayServices.mockResolvedValue(true);
    mockGoogle.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'id-tok' } });
    await expect(load().signInWithGoogle()).resolves.toEqual({ kind: 'token', token: 'id-tok' });
    expect(mockGoogle.configure).toHaveBeenCalledWith({ webClientId: 'web-client' });
  });

  it('Google hủy → cancelled', async () => {
    mockGoogle.hasPlayServices.mockResolvedValue(true);
    mockGoogle.signIn.mockResolvedValue({ type: 'cancelled', data: null });
    await expect(load().signInWithGoogle()).resolves.toEqual({ kind: 'cancelled' });
  });

  it('Không có Play Services → unavailable với thông báo tiếng Việt', async () => {
    mockGoogle.hasPlayServices.mockRejectedValue({ code: 'PLAY' });
    await expect(load().signInWithGoogle()).resolves.toEqual({
      kind: 'unavailable',
      message: 'Máy này không hỗ trợ đăng nhập Google.',
    });
  });

  it('Google thành công nhưng không có idToken → unavailable', async () => {
    mockGoogle.hasPlayServices.mockResolvedValue(true);
    mockGoogle.signIn.mockResolvedValue({ type: 'success', data: { idToken: null } });
    expect((await load().signInWithGoogle()).kind).toBe('unavailable');
  });

  it('thiếu Web Client ID → googleAvailable false', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    expect(load().googleAvailable).toBe(false);
  });

  it('Zalo thành công → accessToken, gọi chế độ app hoặc web', async () => {
    mockZalo.login.mockResolvedValue({ accessToken: 'z-tok', refreshToken: 'r', expiresIn: 1, expiresAt: 1 });
    await expect(load().signInWithZalo()).resolves.toEqual({ kind: 'token', token: 'z-tok' });
    expect(mockZalo.login).toHaveBeenCalledWith('app_or_web');
  });

  it('Zalo lỗi khác hủy → unavailable', async () => {
    mockZalo.login.mockRejectedValue({ code: 'NOT_CONFIGURED', message: 'not configured' });
    expect((await load().signInWithZalo()).kind).toBe('unavailable');
  });

  it('signOutProviders nuốt lỗi', async () => {
    mockGoogle.signOut.mockRejectedValue(new Error('x'));
    mockZalo.logout.mockImplementation(() => {
      throw new Error('y');
    });
    await expect(load().signOutProviders()).resolves.toBeUndefined();
  });
});
```

Thêm một test hủy Zalo dùng đúng mã tìm được ở Step 2:

```ts
  it('Zalo hủy → cancelled', async () => {
    mockZalo.login.mockRejectedValue({ code: '<MÃ HỦY TÌM Ở STEP 2>', message: 'User cancelled' });
    await expect(load().signInWithZalo()).resolves.toEqual({ kind: 'cancelled' });
  });
```

(Thay `<MÃ HỦY TÌM Ở STEP 2>` bằng giá trị thật trước khi chạy; nếu dùng phương án khớp `message`, giữ `code` bất kỳ và `message: 'User cancelled'`.)

Run: `cd apps/mobile && pnpm test -- src/lib/oauth.test.ts`
Expected: FAIL — không tìm thấy `./oauth`.

- [ ] **Step 4: Viết `oauth.ts`**

```ts
// apps/mobile/src/lib/oauth.ts
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import Constants from 'expo-constants';
import { Constants as ZaloConstants, login as zaloLogin, logout as zaloLogout } from 'react-native-zalo-kit';

/**
 * Lấy token từ SDK Google / Zalo để gửi lên backend (spec 2026-10-21-google-zalo-login §3.2).
 * Màn hình không biết gì về SDK: chỉ nhận token, "đã hủy" hoặc lỗi kèm thông báo.
 */
export type OAuthResult =
  | { kind: 'token'; token: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; message: string };

/** Lỗi phía máy (không có Play Services, SDK lỗi) — thông báo đã là tiếng Việt. */
export class OAuthUnavailableError extends Error {}

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
const ZALO_APP_ID = (Constants.expoConfig?.extra?.zaloAppId as string | null | undefined) ?? null;

export const googleAvailable = GOOGLE_WEB_CLIENT_ID !== '';
export const zaloAvailable = !!ZALO_APP_ID;

/** Mã lỗi khi người dùng tự hủy đăng nhập Zalo (đọc từ mã native của react-native-zalo-kit). */
const ZALO_CANCEL_CODES = new Set<string>([/* điền ở Task 5 Step 2 */]);

let googleConfigured = false;

export async function signInWithGoogle(): Promise<OAuthResult> {
  if (!googleConfigured) {
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
    googleConfigured = true;
  }
  try {
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return { kind: 'cancelled' };
    const idToken = response.data.idToken;
    if (!idToken) return { kind: 'unavailable', message: 'Google không trả thông tin đăng nhập. Thử lại.' };
    return { kind: 'token', token: idToken };
  } catch (error) {
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { kind: 'unavailable', message: 'Máy này không hỗ trợ đăng nhập Google.' };
      }
      if (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === statusCodes.IN_PROGRESS) {
        return { kind: 'cancelled' };
      }
    }
    return { kind: 'unavailable', message: 'Không đăng nhập được bằng Google. Thử lại sau ít phút.' };
  }
}

export async function signInWithZalo(): Promise<OAuthResult> {
  try {
    const { accessToken } = await zaloLogin(ZaloConstants.AUTH_VIA_APP_OR_WEB);
    return accessToken ? { kind: 'token', token: accessToken } : { kind: 'cancelled' };
  } catch (error) {
    const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
    if (ZALO_CANCEL_CODES.has(String(code)) || /cancel|hủy|huỷ/i.test(String(message ?? ''))) {
      return { kind: 'cancelled' };
    }
    return { kind: 'unavailable', message: 'Không đăng nhập được bằng Zalo. Thử lại sau ít phút.' };
  }
}

/** Gọi khi đăng xuất, để lần sau người dùng được chọn lại tài khoản. Không bao giờ ném lỗi. */
export async function signOutProviders(): Promise<void> {
  if (googleAvailable) await GoogleSignin.signOut().catch(() => undefined);
  if (zaloAvailable) {
    try {
      zaloLogout();
    } catch {
      // Chưa đăng nhập Zalo hoặc SDK lỗi: không ảnh hưởng đăng xuất khỏi Rong.
    }
  }
}
```

Thay comment `/* điền ở Task 5 Step 2 */` bằng mã thật (hoặc để rỗng theo phương án dự phòng). Nếu tên export của `react-native-zalo-kit` khác (`Constants`, `login`, `logout`), đọc `node_modules/react-native-zalo-kit/src/index.tsx` và sửa import (giữ hành vi).

Run: `cd apps/mobile && pnpm test -- src/lib/oauth.test.ts`
Expected: 9 test PASS.

- [ ] **Step 5: Viết test thất bại cho `auth-context`**

```tsx
// apps/mobile/src/auth/auth-context.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ApiError } from '@/lib/api';

import { AuthProvider, useAuth } from './auth-context';

const mockApiFetch = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, apiFetch: (...args: unknown[]) => mockApiFetch(...args) };
});
jest.mock('@/lib/session-storage', () => ({
  loadSession: jest.fn().mockResolvedValue(null),
  saveSession: jest.fn().mockResolvedValue(undefined),
  clearSession: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/preferences', () => ({ resetInterestsOnSignOut: jest.fn() }));
const mockOauth = {
  signInWithGoogle: jest.fn(),
  signInWithZalo: jest.fn(),
  signOutProviders: jest.fn().mockResolvedValue(undefined),
};
jest.mock('@/lib/oauth', () => {
  const actual = jest.requireActual('@/lib/oauth');
  return {
    ...actual,
    signInWithGoogle: () => mockOauth.signInWithGoogle(),
    signInWithZalo: () => mockOauth.signInWithZalo(),
    signOutProviders: () => mockOauth.signOutProviders(),
  };
});

const TOKENS = {
  accessToken: 'a',
  expiresIn: 900,
  refreshToken: 'r',
  user: { id: 'u1', displayName: 'An', email: null, emailVerified: false, createdAt: '', interests: [] },
};

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

async function setup() {
  const hook = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.status).toBe('signedOut'));
  return hook;
}

beforeEach(() => jest.clearAllMocks());

describe('loginWithGoogle / loginWithZalo', () => {
  it('Google: gửi idToken lên /auth/google rồi vào phiên', async () => {
    mockOauth.signInWithGoogle.mockResolvedValue({ kind: 'token', token: 'id-tok' });
    mockApiFetch.mockResolvedValue(TOKENS);
    const { result } = await setup();
    await act(async () => {
      await expect(result.current.loginWithGoogle()).resolves.toBe('token');
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/auth/google', { method: 'POST', body: { idToken: 'id-tok' } });
    expect(result.current.status).toBe('signedIn');
    expect(result.current.session?.user.id).toBe('u1');
  });

  it('Zalo: gửi accessToken lên /auth/zalo', async () => {
    mockOauth.signInWithZalo.mockResolvedValue({ kind: 'token', token: 'z-tok' });
    mockApiFetch.mockResolvedValue(TOKENS);
    const { result } = await setup();
    await act(async () => {
      await result.current.loginWithZalo();
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/auth/zalo', { method: 'POST', body: { accessToken: 'z-tok' } });
  });

  it('hủy thì không gọi API, vẫn đăng xuất', async () => {
    mockOauth.signInWithGoogle.mockResolvedValue({ kind: 'cancelled' });
    const { result } = await setup();
    await act(async () => {
      await expect(result.current.loginWithGoogle()).resolves.toBe('cancelled');
    });
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(result.current.status).toBe('signedOut');
  });

  it('máy không hỗ trợ → ném OAuthUnavailableError với thông báo', async () => {
    mockOauth.signInWithGoogle.mockResolvedValue({ kind: 'unavailable', message: 'Máy này không hỗ trợ đăng nhập Google.' });
    const { result } = await setup();
    await act(async () => {
      await expect(result.current.loginWithGoogle()).rejects.toThrow('Máy này không hỗ trợ đăng nhập Google.');
    });
  });

  it('backend 401 → ném ApiError, không vào phiên', async () => {
    mockOauth.signInWithGoogle.mockResolvedValue({ kind: 'token', token: 'id-tok' });
    mockApiFetch.mockRejectedValue(new ApiError(401, 'EXTERNAL_TOKEN_INVALID', 'Không xác minh được tài khoản.'));
    const { result } = await setup();
    await act(async () => {
      await expect(result.current.loginWithGoogle()).rejects.toBeInstanceOf(ApiError);
    });
    expect(result.current.status).toBe('signedOut');
  });

  it('đăng xuất gọi signOutProviders', async () => {
    mockOauth.signInWithGoogle.mockResolvedValue({ kind: 'token', token: 'id-tok' });
    mockApiFetch.mockResolvedValue(TOKENS);
    const { result } = await setup();
    await act(async () => {
      await result.current.loginWithGoogle();
    });
    mockApiFetch.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.signOut();
    });
    expect(mockOauth.signOutProviders).toHaveBeenCalled();
  });
});
```

Run: `cd apps/mobile && pnpm test -- src/auth/auth-context.test.tsx`
Expected: FAIL — `loginWithGoogle is not a function`.

- [ ] **Step 6: Sửa `auth-context.tsx`**

1. Import: `import { OAuthUnavailableError, signInWithGoogle, signInWithZalo, signOutProviders, type OAuthResult } from '@/lib/oauth';` và thêm `GoogleLoginRequest, ZaloLoginRequest` vào import kiểu từ `@rong/shared-types`.
2. `AuthContextValue` thêm sau `login`:

```ts
  /**
   * Đăng nhập/đăng ký bằng Google hoặc Zalo. Trả 'token' khi đã vào phiên, 'cancelled' khi người
   * dùng tự hủy; ném ApiError (backend từ chối) hoặc OAuthUnavailableError (máy không hỗ trợ).
   */
  loginWithGoogle: () => Promise<OAuthResult['kind']>;
  loginWithZalo: () => Promise<OAuthResult['kind']>;
```

3. Trong `AuthProvider`, trước `const value = useMemo`:

```tsx
  const loginWith = useCallback(
    async (signIn: () => Promise<OAuthResult>, path: '/auth/google' | '/auth/zalo'): Promise<OAuthResult['kind']> => {
      const result = await signIn();
      if (result.kind === 'cancelled') return 'cancelled';
      if (result.kind === 'unavailable') throw new OAuthUnavailableError(result.message);
      const body: GoogleLoginRequest | ZaloLoginRequest =
        path === '/auth/google' ? { idToken: result.token } : { accessToken: result.token };
      await startSession(await apiFetch<AuthTokens>(path, { method: 'POST', body }));
      return 'token';
    },
    [startSession],
  );
```

4. Trong object của `useMemo`, sau `login`:

```tsx
      loginWithGoogle: () => loginWith(signInWithGoogle, '/auth/google'),
      loginWithZalo: () => loginWith(signInWithZalo, '/auth/zalo'),
```

và thêm `loginWith` vào mảng phụ thuộc của `useMemo`.

5. Trong `signOut`, ngay sau khối thu hồi refresh token:

```tsx
        // Đăng xuất khỏi Google/Zalo trên máy để lần sau được chọn lại tài khoản; lỗi thì thôi.
        void signOutProviders();
```

Run: `cd apps/mobile && pnpm test`
Expected: toàn bộ test mobile PASS (share-link 4, oauth 9, auth-context 6).

- [ ] **Step 7: Typecheck, lint, commit**

Run: `cd apps/mobile && pnpm typecheck && pnpm lint`
Expected: sạch (trừ cảnh báo cũ ở `account.tsx`).

```bash
git add apps/mobile/package.json pnpm-lock.yaml apps/mobile/app.config.ts apps/mobile/.env.example apps/mobile/src/lib/oauth.ts apps/mobile/src/lib/oauth.test.ts apps/mobile/src/auth
git commit -m "feat(mobile): sign in with Google and Zalo SDKs through the auth context"
```

---

### Task 6: Mobile — nút đăng nhập Google/Zalo trên màn login và register

**Files:**
- Create: `apps/mobile/src/components/oauth-buttons.tsx`
- Test: `apps/mobile/src/components/oauth-buttons.test.tsx`
- Modify: `apps/mobile/src/app/(auth)/login.tsx:152-163, 286-316, 334-346`
- Modify: `apps/mobile/src/app/(auth)/register.tsx:202-213, 243-255, 319-331`

**Interfaces:**
- Consumes: `useAuth().loginWithGoogle`, `useAuth().loginWithZalo`, `googleAvailable`, `zaloAvailable`, `OAuthUnavailableError` (Task 5); `ApiError`.
- Produces: `<OAuthButtons label="HOẶC TIẾP TỤC VỚI" disabled={boolean} onBusyChange={(busy) => void} onError={(message: string | null) => void} />` — tự ẩn khi không nhà cung cấp nào được cấu hình.

- [ ] **Step 1: Viết test thất bại**

```tsx
// apps/mobile/src/components/oauth-buttons.test.tsx
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ApiError } from '@/lib/api';

import { OAuthButtons } from './oauth-buttons';

const mockAuth = { loginWithGoogle: jest.fn(), loginWithZalo: jest.fn() };
jest.mock('@/auth/auth-context', () => ({ useAuth: () => mockAuth }));
const mockAvailability = { googleAvailable: true, zaloAvailable: true };
jest.mock('@/lib/oauth', () => {
  const actual = jest.requireActual('@/lib/oauth');
  return {
    OAuthUnavailableError: actual.OAuthUnavailableError,
    get googleAvailable() {
      return mockAvailability.googleAvailable;
    },
    get zaloAvailable() {
      return mockAvailability.zaloAvailable;
    },
  };
});

function renderButtons() {
  const onError = jest.fn();
  const onBusyChange = jest.fn();
  render(<OAuthButtons label="HOẶC TIẾP TỤC VỚI" onError={onError} onBusyChange={onBusyChange} />);
  return { onError, onBusyChange };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAvailability.googleAvailable = true;
  mockAvailability.zaloAvailable = true;
});

describe('OAuthButtons', () => {
  it('chỉ hiện nút của nhà cung cấp đã cấu hình; không có nào thì ẩn cả khối', () => {
    mockAvailability.zaloAvailable = false;
    renderButtons();
    expect(screen.getByRole('button', { name: 'Đăng nhập bằng Google' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Đăng nhập bằng Zalo' })).toBeNull();

    mockAvailability.googleAvailable = false;
    renderButtons();
    expect(screen.queryByText('HOẶC TIẾP TỤC VỚI')).toBeNull();
  });

  it('đang đăng nhập Google thì nút Zalo bị khóa, chỉ một luồng chạy', async () => {
    let finish!: (v: string) => void;
    mockAuth.loginWithGoogle.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { onBusyChange } = renderButtons();
    fireEvent.press(screen.getByRole('button', { name: 'Đăng nhập bằng Google' }));
    fireEvent.press(screen.getByRole('button', { name: 'Đăng nhập bằng Zalo' }));
    expect(mockAuth.loginWithZalo).not.toHaveBeenCalled();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await act(async () => finish('token'));
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('hủy thì không báo lỗi; lỗi backend hay máy thì báo message', async () => {
    const { onError } = renderButtons();
    mockAuth.loginWithGoogle.mockResolvedValueOnce('cancelled');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Đăng nhập bằng Google' })));
    expect(onError).toHaveBeenLastCalledWith(null);

    mockAuth.loginWithZalo.mockRejectedValueOnce(new ApiError(502, 'PROVIDER_UNAVAILABLE', 'Zalo đang không phản hồi.'));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Đăng nhập bằng Zalo' })));
    expect(onError).toHaveBeenLastCalledWith('Zalo đang không phản hồi.');
  });
});
```

Run: `cd apps/mobile && pnpm test -- src/components/oauth-buttons.test.tsx`
Expected: FAIL — không tìm thấy `./oauth-buttons`.

- [ ] **Step 2: Viết component**

Lấy style từ khối `oauthSection` … `oauthLabel` hiện có trong `login.tsx` (dòng 288–316) để giao diện không đổi:

```tsx
// apps/mobile/src/components/oauth-buttons.tsx
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { googleAvailable, OAuthUnavailableError, zaloAvailable } from '@/lib/oauth';

type Provider = 'google' | 'zalo';

type Props = {
  /** Chữ trên đường kẻ, ví dụ "HOẶC TIẾP TỤC VỚI". */
  label: string;
  /** Form email đang gửi: khóa các nút. */
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** null = xóa lỗi cũ; chuỗi = thông báo tiếng Việt để hiện bằng Notice. */
  onError: (message: string | null) => void;
};

/** Nút đăng nhập Google / Zalo dùng chung cho màn đăng nhập và đăng ký (F11). */
export function OAuthButtons({ label, disabled, onBusyChange, onError }: Props) {
  const { loginWithGoogle, loginWithZalo } = useAuth();
  const [pending, setPending] = useState<Provider | null>(null);

  if (!googleAvailable && !zaloAvailable) return null;

  async function start(provider: Provider) {
    if (pending || disabled) return;
    setPending(provider);
    onBusyChange?.(true);
    onError(null);
    try {
      await (provider === 'google' ? loginWithGoogle() : loginWithZalo());
      // Vào phiên xong, Stack.Protected ở layout gốc tự chuyển sang app; hủy thì không làm gì.
    } catch (error) {
      onError(
        error instanceof ApiError || error instanceof OAuthUnavailableError
          ? error.message
          : 'Không đăng nhập được. Thử lại sau ít phút.',
      );
    } finally {
      setPending(null);
      onBusyChange?.(false);
    }
  }

  const locked = disabled || pending !== null;
  return (
    <View style={styles.section}>
      <View style={styles.dividerRow}>
        <View style={styles.divider} />
        <Text style={styles.dividerLabel}>{label}</Text>
        <View style={styles.divider} />
      </View>
      <View style={styles.buttons}>
        {googleAvailable ? (
          <ProviderButton
            name="Google"
            mark="G"
            markColor="#4285F4"
            loading={pending === 'google'}
            disabled={locked}
            onPress={() => start('google')}
          />
        ) : null}
        {zaloAvailable ? (
          <ProviderButton
            name="Zalo"
            mark="Z"
            markColor="#0068FF"
            loading={pending === 'zalo'}
            disabled={locked}
            onPress={() => start('zalo')}
          />
        ) : null}
      </View>
    </View>
  );
}

function ProviderButton({
  name,
  mark,
  markColor,
  loading,
  disabled,
  onPress,
}: {
  name: string;
  mark: string;
  markColor: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Đăng nhập bằng ${name}`}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, (pressed || (disabled && !loading)) && styles.dimmed]}>
      {loading ? (
        <ActivityIndicator size="small" color={markColor} />
      ) : (
        <Text style={[styles.mark, { color: markColor }]}>{mark}</Text>
      )}
      <Text style={styles.name}>{name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  divider: { height: StyleSheet.hairlineWidth, flex: 1, backgroundColor: Palette.parchment400 },
  dividerLabel: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 9,
    letterSpacing: 1,
    color: Palette.charcoalMuted,
  },
  buttons: { flexDirection: 'row', gap: Spacing.two },
  button: {
    minHeight: 48,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.parchment400,
    backgroundColor: '#FFFFFF',
  },
  dimmed: { opacity: 0.6 },
  mark: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 },
  name: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: Palette.charcoal },
});
```

Run: `cd apps/mobile && pnpm test -- src/components/oauth-buttons.test.tsx`
Expected: 3 test PASS.

- [ ] **Step 3: Dùng trong `login.tsx`**

- Thêm state `const [oauthBusy, setOauthBusy] = useState(false);` và import `OAuthButtons` từ `'@/components/oauth-buttons'`.
- Thay cả khối `<View style={styles.oauthSection}> … </View>` (dòng 152–163) bằng:

```tsx
        <OAuthButtons
          label="HOẶC TIẾP TỤC VỚI"
          disabled={submitting}
          onBusyChange={setOauthBusy}
          onError={setFormError}
        />
```

- Nút đăng nhập email: thêm `disabled={oauthBusy}`.
- Xóa hàm `OAuthPlaceholder` và các style `oauthSection`, `dividerRow`, `divider`, `dividerLabel`, `oauthButtons`, `oauthButton`, `oauthMark`, `oauthLabel` (đã chuyển sang component). Xóa import không còn dùng (`Pressable`, `Palette`, `Radius` nếu không còn chỗ nào khác dùng — kiểm tra bằng typecheck/lint).

- [ ] **Step 4: Dùng trong `register.tsx`**

Giống Step 3, với `label="HOẶC ĐĂNG KÝ VỚI"`, khối dòng 202–213, hàm `OAuthPlaceholder` dòng 243–255, style dòng 319–331. Register dùng `formError`/`setFormError` và `submitting` sẵn có (dòng 27–28).

- [ ] **Step 5: Kiểm tra**

Run: `cd apps/mobile && pnpm test && pnpm typecheck && pnpm lint`
Expected: toàn bộ test PASS; typecheck sạch; lint không lỗi mới.

Kiểm tra cấu hình native sinh đúng: `cd apps/mobile && ZALO_APP_ID=123 npx expo config --type prebuild | grep -n "zalo\|google-signin"` → thấy cả hai plugin; không có `ZALO_APP_ID` → không có plugin Zalo.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/oauth-buttons.tsx apps/mobile/src/components/oauth-buttons.test.tsx "apps/mobile/src/app/(auth)/login.tsx" "apps/mobile/src/app/(auth)/register.tsx"
git commit -m "feat(mobile): working Google and Zalo buttons on sign-in and sign-up"
```

---

## Sau khi xong (người dùng tự làm, theo spec §6–§7)

1. Merge, deploy backend (migration chạy trên Render qua `docker-entrypoint.sh` hoặc lệnh migration của Render).
2. Tạo tài khoản Google Cloud và Zalo for Developers theo spec §7; đặt env trên Render.
3. Chạy kiểm tra `appsecret_proof` (spec §7.B.5) trước khi bật Zalo cho người dùng.
4. Đặt env EAS (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `ZALO_APP_ID`), build lại APK, kiểm tra tay theo spec §5.
