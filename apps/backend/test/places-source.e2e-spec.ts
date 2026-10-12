import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';
import { GooglePlacesService } from '../src/modules/google/google-places.service.js';
import { GoogleLocationJanitor } from '../src/modules/places/google-location-janitor.js';

/** Ràng buộc nguồn của bảng places (F4): dòng OSM như cũ, dòng Google chỉ cần place_id. */
describe('places.source (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let token: string;
  let userId: string;
  const google = {
    enabled: true,
    locate: vi.fn(),
    details: vi.fn(async () => null),
    matchPlaceId: vi.fn(async () => null),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({
        planItinerary: vi.fn().mockRejectedValue(new Error('AI giả lỗi')),
        findPlaces: vi.fn(),
      })
      .overrideProvider(GooglePlacesService)
      .useValue(google)
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

  it('saved_places có display_name và chỉ mục share_import_id', async () => {
    const [col] = (await db.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'saved_places' AND column_name = 'display_name'`,
    )) as Array<{ is_nullable: string }>;
    expect(col?.is_nullable).toBe('YES');
    const [index] = (await db.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_saved_place_share_import'`,
    )) as Array<{ indexdef: string }>;
    expect(index?.indexdef).toContain('(share_import_id)');
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

  describe('lịch trình không lưu tọa độ Google', () => {
    let regionId: string;
    let googleId: string;
    let anchorId: string;

    beforeAll(async () => {
      [{ id: regionId }] = (await db.query(
        `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
      )) as Array<{ id: string }>;
      [{ id: googleId }] = (await db.query(
        `INSERT INTO places (source, google_place_id, name, category, location, location_expires_at, composite_score)
         VALUES ('google', 'e2e-src-snap', 'E2E src quán snapshot', 'cafe',
                 ST_SetSRID(ST_MakePoint(108.442, 11.942), 4326), now() + interval '30 days', 0)
         RETURNING id`,
      )) as Array<{ id: string }>;
      [{ id: anchorId }] = (await db.query(
        `INSERT INTO places (osm_type, osm_id, name, category, location, composite_score)
         VALUES ('node', -9330, 'E2E src neo snapshot', 'culture', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 5)
         RETURNING id`,
      )) as Array<{ id: string }>;
    });

    type Item = {
      placeId: string | null;
      place: { coordinates: { lat: number; lng: number } | null } | null;
    };
    const itemOf = (days: Array<{ items: Item[] }>, placeId: string) =>
      days.flatMap((d) => d.items).find((i) => i.placeId === placeId);

    it('JSONB không có tọa độ Google; GET điền tọa độ hiện tại, hết thì null', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/itineraries')
        .set('Authorization', `Bearer ${token}`)
        .send({
          regionId,
          planningMode: 'ai',
          startsAt: '2026-12-01T08:00:00+07:00',
          endsAt: '2026-12-01T20:00:00+07:00',
          travelParty: 'friends',
          adults: 2,
          children: 0,
          allowAiSuggestions: false,
          selectedPlaceIds: [googleId, anchorId],
        })
        .expect(201);
      const id = created.body.id as string;
      expect(itemOf(created.body.days, googleId)?.place?.coordinates).toEqual({
        lat: 11.942,
        lng: 108.442,
      });

      const [stored] = (await db.query(
        `SELECT days FROM itineraries WHERE id = $1`,
        [id],
      )) as Array<{ days: Array<{ items: Item[] }> }>;
      expect(itemOf(stored.days, googleId)?.place?.coordinates).toBeNull();
      expect(itemOf(stored.days, anchorId)?.place?.coordinates).toEqual({
        lat: 11.94,
        lng: 108.44,
      });

      // Sửa lịch trình: bản lưu sau PUT cũng không có tọa độ Google.
      const put = await request(app.getHttpServer())
        .put(`/api/itineraries/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          days: created.body.days.map((d: { id: string }, index: number) => ({
            id: d.id,
            items:
              index === 0
                ? [googleId, anchorId].map((placeId) => ({
                    kind: 'visit',
                    placeId,
                    durationMinutes: 60,
                  }))
                : [],
          })),
          unscheduledPlaceIds: [],
        })
        .expect(200);
      expect(itemOf(put.body.days, googleId)?.place?.coordinates).toEqual({
        lat: 11.942,
        lng: 108.442,
      });
      const [afterPut] = (await db.query(
        `SELECT days FROM itineraries WHERE id = $1`,
        [id],
      )) as Array<{ days: Array<{ items: Item[] }> }>;
      expect(itemOf(afterPut.days, googleId)?.place?.coordinates).toBeNull();

      const share = await request(app.getHttpServer())
        .post(`/api/itineraries/${id}/share-link`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const pub = await request(app.getHttpServer())
        .get(`/api/public/itineraries/${share.body.token}`)
        .expect(200);
      expect(itemOf(pub.body.days, googleId)?.place?.coordinates).toEqual({
        lat: 11.942,
        lng: 108.442,
      });

      await db.query(
        `UPDATE places SET location = NULL, location_expires_at = NULL WHERE id = $1`,
        [googleId],
      );
      const got = await request(app.getHttpServer())
        .get(`/api/itineraries/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(itemOf(got.body.days, googleId)?.place?.coordinates).toBeNull();
      expect(itemOf(got.body.days, anchorId)?.place?.coordinates).toEqual({
        lat: 11.94,
        lng: 108.44,
      });
      const pub2 = await request(app.getHttpServer())
        .get(`/api/public/itineraries/${share.body.token}`)
        .expect(200);
      expect(itemOf(pub2.body.days, googleId)?.place?.coordinates).toBeNull();
    });
  });

  describe('tọa độ Google hết hạn', () => {
    let regionId: string;
    let staleId: string;
    let anchorId: string;

    const createItinerary = (ids: string[]) =>
      request(app.getHttpServer())
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
          selectedPlaceIds: ids,
        });

    beforeAll(async () => {
      [{ id: regionId }] = (await db.query(
        `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
      )) as Array<{ id: string }>;
      [{ id: staleId }] = (await db.query(
        `INSERT INTO places (source, google_place_id, name, category, composite_score)
         VALUES ('google', 'e2e-src-stale', 'E2E src quán hết hạn', 'food', 0) RETURNING id`,
      )) as Array<{ id: string }>;
      [{ id: anchorId }] = (await db.query(
        `INSERT INTO places (osm_type, osm_id, name, category, location, composite_score)
         VALUES ('node', -9320, 'E2E src điểm neo', 'cafe', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 5)
         RETURNING id`,
      )) as Array<{ id: string }>;
    });

    it('janitor xóa tọa độ quá hạn', async () => {
      await db.query(
        `UPDATE places SET location = ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326),
                location_expires_at = now() - interval '1 day' WHERE id = $1`,
        [staleId],
      );
      const count = await app.get(GoogleLocationJanitor).sweep();
      expect(count).toBeGreaterThanOrEqual(1);
      const [row] = (await db.query(
        `SELECT location FROM places WHERE id = $1`,
        [staleId],
      )) as Array<{ location: unknown }>;
      expect(row.location).toBeNull();
    });

    it('lập lịch trình lấy lại tọa độ qua Google rồi dùng địa điểm', async () => {
      google.locate.mockResolvedValueOnce({ lat: 11.941, lng: 108.441 });
      const res = await createItinerary([staleId, anchorId]).expect(201);
      expect(google.locate).toHaveBeenCalledWith('e2e-src-stale');
      const used = res.body.days.flatMap(
        (d: { items: Array<{ placeId: string | null }> }) =>
          d.items.map((i) => i.placeId),
      );
      expect([
        ...used,
        ...res.body.unscheduled.map((u: { placeId: string }) => u.placeId),
      ]).toContain(staleId);
      const [row] = (await db.query(
        `SELECT location_expires_at > now() + interval '29 days' AS fresh FROM places WHERE id = $1`,
        [staleId],
      )) as Array<{ fresh: boolean }>;
      expect(row.fresh).toBe(true);
    });

    it('Google không trả tọa độ: bỏ địa điểm và cảnh báo', async () => {
      await db.query(
        `UPDATE places SET location = NULL, location_expires_at = NULL WHERE id = $1`,
        [staleId],
      );
      google.locate.mockResolvedValueOnce(null);
      const res = await createItinerary([staleId, anchorId]).expect(201);
      expect(res.body.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'place_location_unavailable' }),
        ]),
      );
      const dayItems = res.body.days.flatMap(
        (d: { items: Array<{ placeId: string | null }> }) =>
          d.items.map((i) => i.placeId),
      );
      expect(dayItems).not.toContain(staleId);
      expect(
        res.body.unscheduled.map((u: { placeId: string }) => u.placeId),
      ).not.toContain(staleId);
    });

    it('sửa lịch trình có địa điểm Google mất tọa độ và Google không trả → 503', async () => {
      await db.query(
        `UPDATE places SET location = ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326),
                location_expires_at = now() + interval '30 days' WHERE id = $1`,
        [staleId],
      );
      const created = await createItinerary([staleId, anchorId]).expect(201);
      await db.query(
        `UPDATE places SET location = NULL, location_expires_at = NULL WHERE id = $1`,
        [staleId],
      );
      google.locate.mockResolvedValueOnce(null);
      const res = await request(app.getHttpServer())
        .put(`/api/itineraries/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          days: created.body.days.map((d: { id: string }) => ({
            id: d.id,
            items: [],
          })),
          unscheduledPlaceIds: [staleId, anchorId],
        })
        .expect(503);
      expect(res.body.code).toBe('PLACE_LOCATION_UNAVAILABLE');
    });

    it('chi tiết địa điểm Google không có tọa độ và Google lỗi → 503', async () => {
      await db.query(
        `UPDATE places SET location = NULL, location_expires_at = NULL WHERE id = $1`,
        [staleId],
      );
      google.locate.mockResolvedValueOnce(null);
      const res = await request(app.getHttpServer())
        .get(`/api/places/${staleId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(503);
      expect(res.body.code).toBe('PLACE_LOCATION_UNAVAILABLE');
    });

    it('chi tiết địa điểm Google: không gỡ google_place_id khi Google báo không còn', async () => {
      await db.query(
        `UPDATE places SET location = ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326),
                location_expires_at = now() + interval '30 days' WHERE id = $1`,
        [staleId],
      );
      const res = await request(app.getHttpServer())
        .get(`/api/places/${staleId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.googleStatus).toBe('not_found');
      const [row] = (await db.query(
        `SELECT google_place_id FROM places WHERE id = $1`,
        [staleId],
      )) as Array<{ google_place_id: string }>;
      expect(row.google_place_id).toBe('e2e-src-stale');
    });
  });
});
