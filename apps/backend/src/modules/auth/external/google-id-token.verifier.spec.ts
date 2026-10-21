import {
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
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
  const jwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: 'k1',
    alg: 'RS256',
  };
  jwks = createLocalJWKSet({ keys: [jwk] });
});

function sign(
  claims: Record<string, unknown>,
  opts: { aud?: string; iss?: string; exp?: string } = {},
) {
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
    const token = await sign({
      email: 'An@Gmail.com',
      email_verified: true,
      name: 'An',
    });
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

  it('email ngoài gmail.com chỉ tin khi có hd (Google Workspace)', async () => {
    const consumer = await sign({
      email: 'an@congty.vn',
      email_verified: true,
    });
    const consumerIdentity = await verifier().verify(consumer);
    expect(consumerIdentity.email).toBe('an@congty.vn');
    expect(consumerIdentity.emailVerified).toBe(false);

    const workspace = await sign({
      email: 'an@congty.vn',
      email_verified: true,
      hd: 'congty.vn',
    });
    expect((await verifier().verify(workspace)).emailVerified).toBe(true);
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

  it('không tải được khóa của Google (mạng, timeout, HTTP lỗi, JWKS hỏng) → PROVIDER_UNAVAILABLE', async () => {
    const token = await sign({});
    const failures = [
      new TypeError('fetch failed'),
      new errors.JWKSTimeout(),
      // jose ném JOSEError trơn khi trang khóa trả HTTP ≠ 200 hoặc JSON hỏng.
      new errors.JOSEError(
        'Expected 200 OK from the JSON Web Key Set HTTP response',
      ),
      new errors.JWKSInvalid('JSON Web Key Set malformed'),
    ];
    for (const failure of failures) {
      const v = new GoogleIdTokenVerifier(
        { googleClientIds: [CLIENT_ID], zaloAppId: null, zaloAppSecret: null },
        () => Promise.reject(failure),
      );
      await expect(v.verify(token)).rejects.toMatchObject({
        response: { code: 'PROVIDER_UNAVAILABLE' },
      });
    }
  });

  it('không có khóa khớp kid → EXTERNAL_TOKEN_INVALID', async () => {
    const token = await sign({});
    const v = new GoogleIdTokenVerifier(
      { googleClientIds: [CLIENT_ID], zaloAppId: null, zaloAppSecret: null },
      () => Promise.reject(new errors.JWKSNoMatchingKey()),
    );
    await expect(v.verify(token)).rejects.toMatchObject({
      response: { code: 'EXTERNAL_TOKEN_INVALID' },
    });
  });
});
