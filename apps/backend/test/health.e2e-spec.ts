import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/**
 * Test này nối tới database thật, nên cần `pnpm infra:up` chạy trước.
 * Nó không nằm trong `pnpm test` (chỉ chạy qua `pnpm test:e2e`).
 */
describe('GET /api/health (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    // Mọi route ngoài /auth đều cần JWT; health không phải ngoại lệ.
    accessToken = app
      .get(JwtService)
      .sign({ sub: '00000000-0000-0000-0000-000000000000' });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('trả về ok kèm phiên bản PostGIS', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.dependencies.postgis.status).toBe('up');
    expect(response.body.dependencies.postgis.detail).toBeTruthy();
  });
});
