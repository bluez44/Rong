import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { API_PREFIX, API_PREFIX_OPTIONS } from '../src/global-prefix.js';
import { LangchainService } from '../src/langchain/langchain.service.js';

/**
 * Trang mời `/invite/:token` và `/.well-known/assetlinks.json` (F10): nằm
 * ngoài prefix `api`, không cần đăng nhập, luôn trả HTML cho trang mời.
 */
describe('Trang mời và App Links (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let ownerToken: string;
  let groupId: string;
  let invite: { id: string; token: string };

  beforeAll(async () => {
    process.env.ANDROID_APP_LINK_SHA256 = 'AA:BB, CC:DD';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary: vi.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(API_PREFIX, API_PREFIX_OPTIONS);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    db = app.get(DataSource);
    const [owner] = (await db.query(
      `INSERT INTO users (display_name) VALUES ('e2e-invite-page-owner') RETURNING id`,
    )) as Array<{ id: string }>;
    ownerToken = app.get(JwtService).sign({ sub: owner.id });

    const server = app.getHttpServer();
    const group = await request(server)
      .post('/api/groups')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Đà <b>Lạt</b>' })
      .expect(201);
    groupId = group.body.id;
    const created = await request(server)
      .post(`/api/groups/${groupId}/invites`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    invite = { id: created.body.id, token: created.body.token };
  });

  afterAll(async () => {
    delete process.env.ANDROID_APP_LINK_SHA256;
    await db?.query(
      `DELETE FROM users WHERE display_name LIKE 'e2e-invite-page-%'`,
    );
    await app?.close();
  });

  it('link hợp lệ: HTML, escapes group name, có nút mở app', async () => {
    const res = await request(app.getHttpServer())
      .get(`/invite/${invite.token}`)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Đà &lt;b&gt;Lạt&lt;/b&gt;');
    expect(res.text).not.toContain('<b>Lạt</b>');
    expect(res.text).toContain(`rong://invite/${invite.token}`);
  });

  it('token rác: 404 nhưng vẫn là trang HTML', async () => {
    const res = await request(app.getHttpServer())
      .get('/invite/khong-phai-token')
      .expect(404);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Link mời đã hết hạn hoặc không hợp lệ');
  });

  it('route trang mời không nằm dưới /api', async () => {
    await request(app.getHttpServer())
      .get(`/api/invite/${invite.token}`)
      .expect(404);
  });

  it('assetlinks.json trả fingerprint từ env', async () => {
    const res = await request(app.getHttpServer())
      .get('/.well-known/assetlinks.json')
      .expect(200);
    expect(res.body[0].target.package_name).toBe('vn.rong.app');
    expect(res.body[0].target.sha256_cert_fingerprints).toEqual([
      'AA:BB',
      'CC:DD',
    ]);
  });

  it('link đã thu hồi: 410, HTML', async () => {
    await request(app.getHttpServer())
      .delete(`/api/groups/${groupId}/invites/${invite.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect((res) => expect(res.status).toBeLessThan(300));
    const res = await request(app.getHttpServer())
      .get(`/invite/${invite.token}`)
      .expect(410);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Link mời đã hết hạn hoặc không hợp lệ');
  });
});
