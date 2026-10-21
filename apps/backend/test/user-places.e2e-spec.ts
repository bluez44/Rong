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
  let webPlaceId: string;

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
    const [web] = (await db.query(
      `INSERT INTO places (source, name, category, location, location_source)
       VALUES ('web', 'E2E up Quán web', 'food', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 'ai')
       RETURNING id`,
    )) as Array<{ id: string }>;
    webPlaceId = web.id;
    await api().put(`/api/saved-places/${webPlaceId}`).send({ regionId: daLat }).expect(204);
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

  it('PATCH /places/:id/notes: sửa từng trường, null thì xóa, rỗng hết thì xóa dòng; GET thấy ghi chú của chính mình', async () => {
    await api()
      .patch(`/api/places/${webPlaceId}/notes`)
      .send({ note: 'Bún ngon', priceMin: 30000, priceMax: 50000 })
      .expect(200)
      .expect((r) =>
        expect(r.body).toEqual({ note: 'Bún ngon', openingHours: null, priceMin: 30000, priceMax: 50000 }),
      );
    await api()
      .patch(`/api/places/${webPlaceId}/notes`)
      .send({ openingHours: 'Mo-Su 06:00-10:00' })
      .expect(200);

    const saved = await api().get('/api/saved-places').expect(200);
    expect(
      saved.body.find((s: { placeId: string }) => s.placeId === webPlaceId).notes,
    ).toMatchObject({ note: 'Bún ngon', openingHours: 'Mo-Su 06:00-10:00' });
    const detail = await api().get(`/api/places/${webPlaceId}`).expect(200);
    expect(detail.body.notes.note).toBe('Bún ngon');
    expect(detail.body.createdByMe).toBe(false);
    // Người khác không thấy ghi chú của mình.
    const other = await api(otherToken).get(`/api/places/${webPlaceId}`).expect(200);
    expect(other.body.notes).toBeNull();

    await api()
      .patch(`/api/places/${webPlaceId}/notes`)
      .send({ note: null, openingHours: null, priceMin: null, priceMax: null })
      .expect(200)
      .expect((r) => expect(r.body).toEqual({}));
    const [{ n }] = (await db.query(
      `SELECT count(*)::int AS n FROM place_notes WHERE place_id = $1`,
      [webPlaceId],
    )) as Array<{ n: number }>;
    expect(n).toBe(0);
  });

  it('PATCH notes: giờ sai 400 INVALID_OPENING_HOURS, giá ngược 400 INVALID_PRICE, địa điểm không có 404', async () => {
    await api()
      .patch(`/api/places/${webPlaceId}/notes`)
      .send({ openingHours: 'cả ngày' })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('INVALID_OPENING_HOURS'));
    await api()
      .patch(`/api/places/${webPlaceId}/notes`)
      .send({ priceMin: 9, priceMax: 1 })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('INVALID_PRICE'));
    await api()
      .patch('/api/places/00000000-0000-4000-8000-000000000000/notes')
      .send({ note: 'x' })
      .expect(404);
  });
});
