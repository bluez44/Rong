import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/** Tài khoản (F11): đổi tên hiển thị, xóa tài khoản kèm toàn bộ dữ liệu. */
describe('Tài khoản (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let jwt: JwtService;

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
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM users WHERE display_name LIKE 'e2e-account%'`);
    await app?.close();
  });

  const newUser = async () => {
    const [user] = (await db.query(
      `INSERT INTO users (display_name) VALUES ('e2e-account') RETURNING id`,
    )) as Array<{ id: string }>;
    return { id: user.id, token: jwt.sign({ sub: user.id }) };
  };

  it('đổi tên hiển thị, bỏ khoảng trắng hai đầu', async () => {
    const { token } = await newUser();
    const res = await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: '  e2e-account Minh  ' })
      .expect(200);
    expect(res.body.displayName).toBe('e2e-account Minh');

    for (const displayName of ['   ', 'x'.repeat(51)]) {
      await request(app.getHttpServer())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName })
        .expect(400);
    }
  });

  it('xóa tài khoản xóa luôn lịch trình và "Muốn đi"', async () => {
    const { id, token } = await newUser();
    const [{ id: regionId }] = (await db.query(
      `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
    )) as Array<{ id: string }>;
    const [{ id: placeId }] = (await db.query(
      `INSERT INTO places (osm_type, osm_id, name, category, location, composite_score)
       VALUES ('node', -9300, 'E2E account', 'nature', ST_SetSRID(ST_MakePoint(108.4, 11.9), 4326), 50)
       ON CONFLICT (osm_type, osm_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    )) as Array<{ id: string }>;
    await db.query(
      `INSERT INTO saved_places (user_id, place_id, region_id) VALUES ($1, $2, $3)`,
      [id, placeId, regionId],
    );
    await db.query(
      `INSERT INTO itineraries (owner_id, region_id, planner, starts_at, ends_at, input, days)
       VALUES ($1, $2, 'manual', now(), now() + interval '1 day', '{}', '[]')`,
      [id, regionId],
    );

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const [counts] = (await db.query(
      `SELECT (SELECT count(*)::int FROM users WHERE id = $1) AS users,
              (SELECT count(*)::int FROM itineraries WHERE owner_id = $1) AS itineraries,
              (SELECT count(*)::int FROM saved_places WHERE user_id = $1) AS saved`,
      [id],
    )) as Array<{ users: number; itineraries: number; saved: number }>;
    expect(counts).toEqual({ users: 0, itineraries: 0, saved: 0 });

    // Token còn hạn nhưng tài khoản đã mất.
    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await db.query(`DELETE FROM places WHERE osm_id = -9300`);
  });
});
