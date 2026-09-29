import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/** Danh sách "Muốn đi" (F9), chạy trên database thật như itinerary.e2e-spec. */
describe('Muốn đi (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let token: string;
  let otherToken: string;
  let daLat: string;
  let hoiAn: string;
  const ids: string[] = [];

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
      `INSERT INTO users (display_name) VALUES ('e2e-saved'), ('e2e-saved-other') RETURNING id`,
    )) as Array<{ id: string }>;
    token = jwt.sign({ sub: user.id });
    otherToken = jwt.sign({ sub: other.id });

    const regions = (await db.query(
      `SELECT id, source_key FROM regions
        WHERE source_key IN ('vn:destination:da-lat', 'vn:destination:hoi-an')`,
    )) as Array<{ id: string; source_key: string }>;
    daLat = regions.find((r) => r.source_key.endsWith('da-lat'))!.id;
    hoiAn = regions.find((r) => r.source_key.endsWith('hoi-an'))!.id;

    for (const [i, name] of ['Hồ Xuân Hương', 'Chùa Cầu'].entries()) {
      const [row] = (await db.query(
        `INSERT INTO places (osm_type, osm_id, name, category, location, composite_score)
         VALUES ('node', $1, $2, 'culture', ST_SetSRID(ST_MakePoint(108.4, 11.9), 4326), 50)
         ON CONFLICT (osm_type, osm_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [-9100 - i, `E2E ${name}`],
      )) as Array<{ id: string }>;
      ids.push(row.id);
    }
  });

  afterAll(async () => {
    await db?.query(
      `DELETE FROM users WHERE display_name IN ('e2e-saved', 'e2e-saved-other')`,
    );
    await db?.query(
      `DELETE FROM places WHERE osm_id <= -9100 AND osm_id > -9200`,
    );
    await app?.close();
  });

  const api = (as = token) => {
    const server = app.getHttpServer();
    const auth = (req: request.Test) =>
      req.set('Authorization', `Bearer ${as}`);
    return {
      list: () => auth(request(server).get('/api/saved-places')),
      save: (placeId: string, regionId: string) =>
        auth(request(server).put(`/api/saved-places/${placeId}`)).send({
          regionId,
        }),
      remove: (placeId: string) =>
        auth(request(server).delete(`/api/saved-places/${placeId}`)),
    };
  };

  it('lưu, liệt kê mới nhất trước, lưu lại thì đổi vùng, bỏ lưu', async () => {
    await api().save(ids[0], daLat).expect(204);
    await api().save(ids[1], hoiAn).expect(204);
    // Lưu lại: idempotent, chuyển sang vùng mới.
    await api().save(ids[1], daLat).expect(204);

    let res = await api().list().expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((s: { placeId: string }) => s.placeId)).toEqual([
      ids[1],
      ids[0],
    ]);
    expect(res.body[0]).toMatchObject({
      name: 'E2E Chùa Cầu',
      category: 'culture',
      regionId: daLat,
    });
    expect(typeof res.body[0].regionName).toBe('string');

    // Người khác không thấy danh sách của mình.
    await api(otherToken)
      .list()
      .expect(200)
      .expect((r) => expect(r.body).toEqual([]));

    await api().remove(ids[0]).expect(204);
    await api().remove(ids[0]).expect(204);
    res = await api().list().expect(200);
    expect(res.body.map((s: { placeId: string }) => s.placeId)).toEqual([
      ids[1],
    ]);
  });

  it('từ chối địa điểm hoặc vùng không tồn tại', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';
    const res = await api().save(missing, daLat).expect(404);
    expect(res.body.code).toBe('PLACE_NOT_FOUND');
    const bad = await api().save(ids[0], missing).expect(400);
    expect(bad.body.code).toBe('UNKNOWN_REGION');
    await api().save(ids[0], 'not-a-uuid').expect(400);
  });

  it('cần đăng nhập', async () => {
    await request(app.getHttpServer()).get('/api/saved-places').expect(401);
  });
});
