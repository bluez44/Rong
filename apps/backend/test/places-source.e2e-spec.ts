import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';

/** Ràng buộc nguồn của bảng places (F4): dòng OSM như cũ, dòng Google chỉ cần place_id. */
describe('places.source (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({
        planItinerary: vi.fn().mockRejectedValue(new Error('AI giả lỗi')),
        findPlaces: vi.fn(),
      })
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
    const [user] = (await db.query(
      `INSERT INTO users (display_name) VALUES ('e2e-src') RETURNING id`,
    )) as Array<{ id: string }>;
    userId = user.id;
    token = app.get(JwtService).sign({ sub: user.id });
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await db?.query(
      `DELETE FROM places WHERE google_place_id LIKE 'e2e-src-%' OR (osm_id <= -9300 AND osm_id > -9400)`,
    );
    await app?.close();
  });

  it('dòng OSM cũ mặc định source = osm', async () => {
    const [row] = (await db.query(
      `INSERT INTO places (osm_type, osm_id, name, category, location, composite_score)
       VALUES ('node', -9300, 'E2E src osm', 'food', ST_SetSRID(ST_MakePoint(108.4, 11.9), 4326), 10)
       RETURNING source`,
    )) as Array<{ source: string }>;
    expect(row.source).toBe('osm');
  });

  it('dòng OSM thiếu tọa độ bị từ chối', async () => {
    await expect(
      db.query(
        `INSERT INTO places (osm_type, osm_id, name, category, composite_score)
         VALUES ('node', -9301, 'E2E src osm thiếu', 'food', 10)`,
      ),
    ).rejects.toThrow(/chk_place_source/);
  });

  it('dòng Google chỉ cần google_place_id, không cần osm hay tọa độ', async () => {
    await db.query(
      `INSERT INTO places (source, google_place_id, name, category, composite_score)
       VALUES ('google', 'e2e-src-1', 'E2E src google', 'cafe', 0)`,
    );
    await expect(
      db.query(
        `INSERT INTO places (source, name, category, composite_score)
         VALUES ('google', 'E2E src google thiếu id', 'cafe', 0)`,
      ),
    ).rejects.toThrow(/chk_place_source/);
  });

  it('một google_place_id chỉ có một dòng Google', async () => {
    await expect(
      db.query(
        `INSERT INTO places (source, google_place_id, name, category, composite_score)
         VALUES ('google', 'e2e-src-1', 'E2E src google 2', 'cafe', 0)`,
      ),
    ).rejects.toThrow(/uq_place_google/);
  });

  it('có bảng share_imports và cột nguồn của saved_places', async () => {
    const cols = (await db.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE (table_name = 'share_imports')
           OR (table_name = 'saved_places' AND column_name IN ('source', 'share_import_id'))`,
    )) as Array<{ table_name: string; column_name: string }>;
    const names = cols.map((c) => `${c.table_name}.${c.column_name}`);
    expect(names).toEqual(
      expect.arrayContaining([
        'share_imports.status',
        'share_imports.candidates',
        'saved_places.source',
        'saved_places.share_import_id',
      ]),
    );
  });

  describe('dòng Google không được liệt kê hay xếp hạng', () => {
    let regionId: string;
    let osmId: string;
    let googleId: string;
    let fetchedAt: Date | null;

    beforeAll(async () => {
      [{ id: regionId, places_fetched_at: fetchedAt }] = (await db.query(
        `SELECT id, places_fetched_at FROM regions WHERE source_key = 'vn:destination:da-lat'`,
      )) as Array<{ id: string; places_fetched_at: Date | null }>;
      // Coi như vùng đã tải xong từ OSM để GET không gọi Overpass.
      await db.query(
        `UPDATE regions SET places_fetched_at = now() WHERE id = $1`,
        [regionId],
      );
      [{ id: osmId }] = (await db.query(
        `INSERT INTO places (osm_type, osm_id, name, category, location, composite_score)
         VALUES ('node', -9310, 'E2E src Cà phê Rêu', 'cafe', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 5)
         RETURNING id`,
      )) as Array<{ id: string }>;
      // Điểm cao hơn mọi dòng OSM, cùng loại, ngay cạnh: nếu lọt thì chắc chắn đứng đầu.
      [{ id: googleId }] = (await db.query(
        `INSERT INTO places (source, google_place_id, name, category, location, location_expires_at, composite_score)
         VALUES ('google', 'e2e-src-rank', 'E2E src Cà phê Rêu Google', 'cafe',
                 ST_SetSRID(ST_MakePoint(108.4401, 11.9401), 4326), now() + interval '30 days', 100)
         RETURNING id`,
      )) as Array<{ id: string }>;
    });

    afterAll(async () => {
      await db.query(
        `UPDATE regions SET places_fetched_at = $2 WHERE id = $1`,
        [regionId, fetchedAt],
      );
    });

    it('GET /regions/:id/places không trả dòng Google', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/regions/${regionId}/places?categories=cafe&limit=50`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const ids = res.body.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(osmId);
      expect(ids).not.toContain(googleId);
    });

    it('matchCatalog không khớp vào dòng Google', async () => {
      const { matchCatalog } =
        await import('../src/modules/places/catalog-match.js');
      const matches = await matchCatalog(
        db,
        ['E2E src Cà phê Rêu Google'],
        null,
      );
      expect(matches.map((m) => m.id)).not.toContain(googleId);
    });

    it('extras của lịch trình không lấy dòng Google', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/itineraries')
        .set('Authorization', `Bearer ${token}`)
        .send({
          regionId,
          planningMode: 'ai',
          startsAt: '2026-12-01T08:00:00+07:00',
          endsAt: '2026-12-02T20:00:00+07:00',
          travelParty: 'friends',
          adults: 2,
          children: 0,
          selectedPlaceIds: [osmId],
        })
        .expect(201);
      const used = res.body.days.flatMap(
        (d: { items: Array<{ placeId: string | null }> }) =>
          d.items.map((i) => i.placeId),
      );
      expect(used).not.toContain(googleId);

      const alt = await request(app.getHttpServer())
        .get(`/api/itineraries/${res.body.id}/alternatives`)
        .query({ placeId: osmId })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(alt.body.map((a: { id: string }) => a.id)).not.toContain(googleId);
    });
  });
});
