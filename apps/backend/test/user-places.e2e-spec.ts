import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/** Địa điểm tự ghim và ghi chú riêng (spec 2026-10-21-user-pinned-places), trên database thật. */
describe('Địa điểm tự ghim và ghi chú (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let userId: string;
  let otherId: string;
  let token: string;
  let otherToken: string;
  let daLat: string;

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
    const jwt = app.get(JwtService);
    const [user, other] = (await db.query(
      `INSERT INTO users (display_name) VALUES ('e2e-user-places'), ('e2e-user-places-other') RETURNING id`,
    )) as Array<{ id: string }>;
    userId = user.id;
    otherId = other.id;
    token = jwt.sign({ sub: userId });
    otherToken = jwt.sign({ sub: otherId });
    const [region] = (await db.query(
      `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
    )) as Array<{ id: string }>;
    daLat = region.id;
  });

  afterAll(async () => {
    await db?.query(
      `DELETE FROM users WHERE display_name IN ('e2e-user-places', 'e2e-user-places-other')`,
    );
    await db?.query(`DELETE FROM places WHERE name LIKE 'E2E up %'`);
    await app?.close();
  });

  /** Request kèm JWT của người dùng chính (hoặc `as`). */
  const api = (as?: string) => {
    const server = app.getHttpServer();
    const auth = (req: request.Test) =>
      req.set('Authorization', `Bearer ${as ?? token}`);
    return {
      get: (url: string) => auth(request(server).get(url)),
      post: (url: string) => auth(request(server).post(url)),
      patch: (url: string) => auth(request(server).patch(url)),
      put: (url: string) => auth(request(server).put(url)),
    };
  };

  it('DB: dòng user cần created_by và tọa độ; place_notes chặn giá ngược', async () => {
    await expect(
      db.query(
        `INSERT INTO places (source, name, category, location, location_source)
         VALUES ('user', 'E2E up thiếu người tạo', 'food', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 'user')`,
      ),
    ).rejects.toThrow(/chk_place_source/);
    const [row] = (await db.query(
      `INSERT INTO places (source, name, category, location, location_source, created_by)
       VALUES ('user', 'E2E up hợp lệ', 'food', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 'user', $1)
       RETURNING id`,
      [userId],
    )) as Array<{ id: string }>;
    await expect(
      db.query(
        `INSERT INTO place_notes (user_id, place_id, price_min, price_max) VALUES ($1, $2, 200, 100)`,
        [userId, row.id],
      ),
    ).rejects.toThrow(/chk_place_notes_price/);
  });
});
