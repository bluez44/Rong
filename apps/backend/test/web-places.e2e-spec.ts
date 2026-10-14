import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { GooglePlacesService } from '../src/modules/google/google-places.service.js';
import { GoogleLocationJanitor } from '../src/modules/places/google-location-janitor.js';
import { PlaceLocationService } from '../src/modules/places/place-location.service.js';
import {
  RegionPlaceStore,
  type WebPlaceInput,
} from '../src/modules/places/region-place-store.js';

/** Dòng `web` của danh sách địa điểm từ bài viết (spec 2026-10-14). */
describe('Địa điểm từ bài viết (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let regionId: string;

  const google = {
    enabled: true,
    findPlace: vi.fn(),
    locate: vi.fn(),
    searchByName: vi.fn(async () => []),
    searchText: vi.fn(async () => []),
    details: vi.fn(async () => null),
    preview: vi.fn(),
    summary: vi.fn(async () => null),
    geocode: vi.fn(async () => null),
    matchPlaceId: vi.fn(async () => null),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GooglePlacesService)
      .useValue(google)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    db = app.get(DataSource);
    // Vùng riêng cho test: các e2e chạy song song trên cùng DB nên không dùng vùng thật.
    const [region] = (await db.query(
      `INSERT INTO regions (source_key, name, type, boundary_version, search_name, bbox_south, bbox_west, bbox_north, bbox_east)
       VALUES ('e2e:web-places', 'Vùng e2e web places', 'destination', 'current', 'vung e2e web places', 11.85, 108.35, 12.05, 108.55)
       ON CONFLICT (source_key) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    )) as Array<{ id: string }>;
    regionId = region.id;
  });

  afterAll(async () => {
    if (regionId) {
      await db?.query(`DELETE FROM region_places WHERE region_id = $1`, [regionId]);
      await db?.query(`DELETE FROM region_place_lists WHERE region_id = $1`, [regionId]);
    }
    await db?.query(`DELETE FROM places WHERE name LIKE 'E2E wp %'`);
    await db?.query(`DELETE FROM regions WHERE source_key = 'e2e:web-places'`);
    await app?.close();
  });

  beforeEach(() => vi.clearAllMocks());

  const webRow = async (
    name: string,
    googlePlaceId: string | null,
    expiresInDays: number | null,
  ): Promise<string> => {
    const [row] = (await db.query(
      `INSERT INTO places (source, name, category, google_place_id, location, location_source,
                           location_expires_at, composite_score)
       VALUES ('web', $1, 'nature', $2, ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), $3,
               CASE WHEN $4::int IS NULL THEN NULL ELSE now() + make_interval(days => $4::int) END, 0)
       RETURNING id`,
      [name, googlePlaceId, googlePlaceId ? 'google' : 'ai', expiresInDays],
    )) as Array<{ id: string }>;
    return row.id;
  };

  describe('lưu trữ', () => {
    it('janitor xóa tọa độ Google quá hạn của dòng web, giữ tọa độ AI', async () => {
      const expired = await webRow('E2E wp hết hạn', 'wp-expired', -1);
      const ai = await webRow('E2E wp AI', null, null);

      await app.get(GoogleLocationJanitor).sweep();

      const rows = (await db.query(
        `SELECT id, location IS NULL AS gone FROM places WHERE id = ANY($1::uuid[])`,
        [[expired, ai]],
      )) as Array<{ id: string; gone: boolean }>;
      expect(rows.find((r) => r.id === expired)!.gone).toBe(true);
      expect(rows.find((r) => r.id === ai)!.gone).toBe(false);
    });

    it('ensure lấy lại tọa độ Google cho dòng web đã hết hạn', async () => {
      const id = await webRow('E2E wp làm mới', 'wp-refresh', -1);
      google.locate.mockResolvedValueOnce({ lat: 11.95, lng: 108.45 });

      await expect(app.get(PlaceLocationService).ensure([id])).resolves.toEqual([]);

      expect(google.locate).toHaveBeenCalledWith('wp-refresh');
      const [row] = (await db.query(
        `SELECT ST_Y(location) AS lat, location_expires_at > now() AS fresh FROM places WHERE id = $1`,
        [id],
      )) as Array<{ lat: number; fresh: boolean }>;
      expect(Number(row.lat)).toBeCloseTo(11.95);
      expect(row.fresh).toBe(true);
    });

    it('không cho hai dòng web/google trùng place_id', async () => {
      await webRow('E2E wp trùng 1', 'wp-dup', 30);
      await expect(webRow('E2E wp trùng 2', 'wp-dup', 30)).rejects.toThrow(/uq_place_google/);
    });
  });
  describe('RegionPlaceStore', () => {
    const article = { title: 'Bài A', uri: 'https://a.test/1', publishedAt: null };
    const input = (name: string, location: WebPlaceInput['location']): WebPlaceInput => ({
      name,
      category: 'nature',
      description: 'Mô tả',
      openingHours: '07:00-17:00',
      articles: [article],
      location,
    });

    beforeEach(async () => {
      await db.query(`DELETE FROM region_places WHERE region_id = $1`, [regionId]);
      await db.query(`DELETE FROM region_place_lists WHERE region_id = $1`, [regionId]);
    });

    it('lưu danh sách theo thứ tự, đánh dấu ready và hạn làm mới', async () => {
      const store = app.get(RegionPlaceStore);
      const ids = await store.replace(
        regionId,
        [
          input('E2E wp Thác A', { source: 'google', placeId: 'wp-a', lat: 11.9, lng: 108.44 }),
          input('E2E wp Đồi B', { source: 'ai', lat: 11.92, lng: 108.45 }),
        ],
        [article],
        30,
      );
      expect(ids).toHaveLength(2);

      const rows = await store.list(regionId, null);
      expect(rows.map((r) => [r.name, r.location_source, r.rank])).toEqual([
        ['E2E wp Thác A', 'google', 0],
        ['E2E wp Đồi B', 'ai', 1],
      ]);
      expect(rows[0].opening_hours).toBe('07:00-17:00');
      expect(rows[0].articles).toEqual([article]);
      const state = await store.state(regionId);
      expect(state?.status).toBe('ready');
      expect(state!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    });

    it('trùng place_id với dòng người dùng đã lưu thì dùng lại dòng đó, giữ tên', async () => {
      const [saved] = (await db.query(
        `INSERT INTO places (source, google_place_id, name, category, location, location_source, location_expires_at, composite_score)
         VALUES ('google', 'wp-saved', 'E2E wp Tên người dùng', 'food', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326),
                 'google', now() + interval '30 days', 0)
         RETURNING id`,
      )) as Array<{ id: string }>;

      const [id] = await app.get(RegionPlaceStore).replace(
        regionId,
        [input('E2E wp Tên bài viết', { source: 'google', placeId: 'wp-saved', lat: 11.94, lng: 108.44 })],
        [],
        30,
      );

      expect(id).toBe(saved.id);
      const [row] = (await db.query(`SELECT name FROM places WHERE id = $1`, [id])) as Array<{ name: string }>;
      expect(row.name).toBe('E2E wp Tên người dùng');
    });

    it('làm mới: dòng AI cùng tên được dùng lại, ghép được Google thì nâng cấp chính dòng đó', async () => {
      const store = app.get(RegionPlaceStore);
      const [first] = await store.replace(regionId, [input('E2E wp Hồ C', { source: 'ai', lat: 11.93, lng: 108.43 })], [], 30);
      const [again] = await store.replace(regionId, [input('E2E wp Hồ C', { source: 'ai', lat: 11.93, lng: 108.43 })], [], 30);
      expect(again).toBe(first);

      const [upgraded] = await store.replace(
        regionId,
        [input('E2E wp Hồ C', { source: 'google', placeId: 'wp-c', lat: 11.931, lng: 108.431 })],
        [],
        30,
      );
      expect(upgraded).toBe(first);
      const [row] = (await db.query(
        `SELECT location_source, google_place_id, location_expires_at IS NOT NULL AS expires FROM places WHERE id = $1`,
        [first],
      )) as Array<{ location_source: string; google_place_id: string; expires: boolean }>;
      expect(row).toEqual({ location_source: 'google', google_place_id: 'wp-c', expires: true });
    });

    it('list lọc theo danh mục', async () => {
      const store = app.get(RegionPlaceStore);
      await store.replace(
        regionId,
        [
          input('E2E wp Thác D', { source: 'ai', lat: 11.9, lng: 108.4 }),
          { ...input('E2E wp Quán E', { source: 'ai', lat: 11.9, lng: 108.4 }), category: 'food' },
        ],
        [],
        30,
      );
      expect((await store.list(regionId, ['food'])).map((r) => r.name)).toEqual(['E2E wp Quán E']);
    });
  });
});
