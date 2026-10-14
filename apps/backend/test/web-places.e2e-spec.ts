import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { GooglePlacesService } from '../src/modules/google/google-places.service.js';
import { GoogleLocationJanitor } from '../src/modules/places/google-location-janitor.js';
import { PlaceLocationService } from '../src/modules/places/place-location.service.js';

/** Dòng `web` của danh sách địa điểm từ bài viết (spec 2026-10-14). */
describe('Địa điểm từ bài viết (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;

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
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM places WHERE name LIKE 'E2E wp %'`);
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
});
