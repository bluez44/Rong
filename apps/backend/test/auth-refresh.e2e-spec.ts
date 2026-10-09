import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/modules/auth/password.service.js';

/**
 * Refresh token (F11) trên database thật: đổi token, phát hiện dùng lại thì
 * thu hồi cả họ, đăng xuất, và hai request đổi cùng một token song song.
 */
describe('Refresh token (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  const password = 'mat-khau-e2e-du-dai';
  let accounts = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    // refresh_tokens và auth_identities xóa theo user (ON DELETE CASCADE).
    await db?.query(`DELETE FROM users WHERE display_name = 'e2e-refresh'`);
    await app?.close();
  });

  /** Tài khoản đã xác minh email, rồi đăng nhập qua API để lấy cặp token. */
  async function signIn() {
    const email = `e2e-refresh-${Date.now()}-${++accounts}@rong.test`;
    const [user] = (await db.query(
      `INSERT INTO users (display_name) VALUES ('e2e-refresh') RETURNING id`,
    )) as Array<{ id: string }>;
    await db.query(
      `INSERT INTO auth_identities (user_id, provider, provider_account_id, email, email_verified_at, password_hash)
       VALUES ($1, 'password', $2, $2, now(), $3)`,
      [user.id, email, await app.get(PasswordService).hash(password)],
    );
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return {
      userId: user.id,
      accessToken: res.body.accessToken as string,
      refreshToken: res.body.refreshToken as string,
    };
  }

  const refresh = (refreshToken: string) =>
    request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken });

  const me = (accessToken: string) =>
    request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`);

  it('đăng nhập trả refresh token; đổi được cặp token mới dùng ngay được', async () => {
    const { userId, refreshToken } = await signIn();
    expect(refreshToken).toMatch(/^[\w-]{40,}$/);

    const res = await refresh(refreshToken).expect(200);

    expect(res.body.refreshToken).not.toBe(refreshToken);
    expect(res.body.expiresIn).toBeGreaterThan(0);
    expect(res.body.user.id).toBe(userId);
    await me(res.body.accessToken).expect(200);

    // Database chỉ giữ hash, không giữ token gốc.
    const rows = (await db.query(
      `SELECT token_hash FROM refresh_tokens WHERE user_id = $1`,
      [userId],
    )) as Array<{ token_hash: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.token_hash)).not.toContain(refreshToken);
  });

  it('token đã dùng bị đưa ra lần nữa: từ chối và thu hồi cả họ', async () => {
    const { refreshToken: first } = await signIn();
    const second = (await refresh(first).expect(200)).body
      .refreshToken as string;

    const reuse = await refresh(first).expect(401);
    expect(reuse.body.code).toBe('INVALID_REFRESH_TOKEN');

    // Token mới nhất của họ cũng mất hiệu lực: người dùng thật phải đăng nhập lại.
    await refresh(second).expect(401);
  });

  it('thu hồi chỉ ảnh hưởng một lần đăng nhập, không đụng thiết bị khác', async () => {
    const phone = await signIn();
    const [identity] = (await db.query(
      `SELECT email FROM auth_identities WHERE user_id = $1`,
      [phone.userId],
    )) as Array<{ email: string }>;
    const tablet = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: identity.email, password })
        .expect(200)
    ).body.refreshToken as string;

    await refresh(phone.refreshToken).expect(200);
    await refresh(phone.refreshToken).expect(401);

    await refresh(tablet).expect(200);
  });

  it('đăng xuất thu hồi refresh token; đăng xuất lại hay token lạ vẫn 204', async () => {
    const { refreshToken } = await signIn();

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken })
      .expect(204);
    await refresh(refreshToken).expect(401);

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken })
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken: 'khong-ton-tai' })
      .expect(204);
  });

  it('hai request đổi cùng một token song song: chỉ một bên được', async () => {
    const { refreshToken } = await signIn();

    const results = await Promise.all([
      refresh(refreshToken),
      refresh(refreshToken),
    ]);

    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 401,
    ]);
  });

  it('token hết hạn hoặc thiếu trong body bị từ chối', async () => {
    const { userId, refreshToken } = await signIn();
    await db.query(
      `UPDATE refresh_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1`,
      [userId],
    );
    await refresh(refreshToken).expect(401);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({})
      .expect(400);
  });

  it('xóa tài khoản thì refresh token cũng mất', async () => {
    const { accessToken, refreshToken } = await signIn();

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    await refresh(refreshToken).expect(401);
  });
});
