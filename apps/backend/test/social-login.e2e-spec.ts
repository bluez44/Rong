import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import {
  externalTokenInvalid,
  providerNotConfigured,
  type ExternalIdentity,
} from '../src/modules/auth/external/external-identity.js';
import { GoogleIdTokenVerifier } from '../src/modules/auth/external/google-id-token.verifier.js';
import { ZaloProfileClient } from '../src/modules/auth/external/zalo-profile.client.js';
import { PasswordService } from '../src/modules/auth/password.service.js';

/** Token giả → danh tính. Mỗi test tự đăng ký token của mình; token lạ → 401. */
const fakes = new Map<string, ExternalIdentity | 'not-configured'>();
const resolveFake = (token: string) => {
  const found = fakes.get(token);
  if (found === 'not-configured') {
    return Promise.reject(providerNotConfigured('Google'));
  }
  if (!found) return Promise.reject(externalTokenInvalid());
  return Promise.resolve(found);
};

/**
 * Đăng nhập Google / Zalo (spec 2026-10-21-google-zalo-login): tạo, gộp theo
 * email đã xác minh, đăng nhập đồng thời, lỗi và xóa tài khoản.
 */
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
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    // auth_identities và refresh_tokens xóa theo user (ON DELETE CASCADE).
    await db?.query(
      `DELETE FROM users WHERE id IN (
         SELECT user_id FROM auth_identities
          WHERE provider_account_id LIKE $1 OR email LIKE $1)`,
      [`e2e-social-${run}-%`],
    );
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const google = (idToken: string) =>
    http().post('/api/auth/google').send({ idToken });
  const zalo = (accessToken: string) =>
    http().post('/api/auth/zalo').send({ accessToken });

  function googleIdentity(
    over: Partial<ExternalIdentity> = {},
  ): ExternalIdentity {
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
      [
        user.id,
        email,
        await app.get(PasswordService).hash('mat-khau-e2e-du-dai'),
      ],
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
      user: {
        displayName: 'Người Google',
        email: identity.email,
        emailVerified: true,
      },
    });
    const second = await google('g-first').expect(200);
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it('gộp vào tài khoản mật khẩu cùng email (không phân biệt hoa thường) và xác minh email của nó', async () => {
    const email = `${uid()}@gmail.test`;
    const userId = await passwordAccount(email);
    fakes.set('g-merge', googleIdentity({ email: email.toUpperCase() }));
    const res = await google('g-merge').expect(200);
    expect(res.body.user).toMatchObject({
      id: userId,
      displayName: 'Người cũ',
      emailVerified: true,
    });
    // Danh tính mật khẩu giờ đã xác minh: đăng nhập bằng mật khẩu được.
    await http()
      .post('/api/auth/login')
      .send({ email, password: 'mat-khau-e2e-du-dai' })
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

    fakes.set('z-noname', {
      provider: 'zalo',
      accountId: uid(),
      email: null,
      emailVerified: false,
      displayName: null,
    });
    expect(
      (await zalo('z-noname').expect(200)).body.user.displayName,
    ).toBeNull();
  });

  it('Zalo không bao giờ gộp theo email', async () => {
    // Zalo không có email; dù danh tính giả có email cũng không được gộp.
    const email = `${uid()}@gmail.test`;
    const userId = await passwordAccount(email, true);
    fakes.set('z-email', {
      provider: 'zalo',
      accountId: uid(),
      email,
      emailVerified: true,
      displayName: null,
    });
    expect((await zalo('z-email').expect(200)).body.user.id).not.toBe(userId);
  });

  it('hai lần đăng nhập đầu tiên đồng thời cùng sub → cùng user, không 500', async () => {
    fakes.set('g-race', googleIdentity());
    const [a, b] = await Promise.all([google('g-race'), google('g-race')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.user.id).toBe(b.body.user.id);
  });

  it('token sai → 401; chưa cấu hình → 503; body sai → 400', async () => {
    expect((await google('khong-ai-biet').expect(401)).body.code).toBe(
      'EXTERNAL_TOKEN_INVALID',
    );
    fakes.set('g-off', 'not-configured');
    expect((await google('g-off').expect(503)).body.code).toBe(
      'PROVIDER_NOT_CONFIGURED',
    );
    await http().post('/api/auth/google').send({}).expect(400);
    await http().post('/api/auth/zalo').send({ accessToken: 1 }).expect(400);
  });

  it('xóa tài khoản xóa luôn danh tính; đăng nhập lại tạo user mới', async () => {
    fakes.set('g-delete', googleIdentity());
    const first = await google('g-delete').expect(200);
    const deleted = await http()
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${first.body.accessToken}`);
    expect([200, 204]).toContain(deleted.status);
    const again = await google('g-delete').expect(200);
    expect(again.body.user.id).not.toBe(first.body.user.id);
  });
});
