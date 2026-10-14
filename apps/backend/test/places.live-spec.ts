import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { RegionPlaceStore } from '../src/modules/places/region-place-store.js';
import { WebPlacesService } from '../src/modules/places/web-places.service.js';

/**
 * Đo thật: gọi Tavily, Gemini, Google thật (tốn tiền, kết quả dao động theo
 * mạng), nên không nằm trong `pnpm test:e2e`. Chạy bằng `pnpm bench:places`;
 * đổi vùng bằng PLACES_LIVE_REGION (source_key), mặc định Đà Lạt.
 *
 * Mỗi lần chạy tổng hợp lại danh sách của vùng (ghi đè danh sách đã lưu như
 * lần làm mới thật), rồi in số địa điểm, số ghép được Google, số dùng tọa độ
 * AI và thời gian, để chỉnh ngưỡng ghép tên (`MATCH_MIN_SIMILARITY`).
 */
const REGION_KEY = process.env.PLACES_LIVE_REGION ?? 'vn:destination:da-lat';
const CACHED_BUDGET_MS = 3000;

describe.skipIf(!process.env.TAVILY_API_KEY || !process.env.GEMINI_API_KEY)(
  `Đo thật: ${REGION_KEY}`,
  () => {
    let app: INestApplication;
    let db: DataSource;
    let token: string;
    let regionId: string;

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
      const [user] = (await db.query(
        `INSERT INTO users (display_name) VALUES ('e2e-live') RETURNING id`,
      )) as Array<{ id: string }>;
      token = app.get(JwtService).sign({ sub: user.id });

      const [region] = (await db.query(
        `SELECT id FROM regions WHERE source_key = $1`,
        [REGION_KEY],
      )) as Array<{ id: string }>;
      if (!region) throw new Error(`Không có vùng ${REGION_KEY}`);
      regionId = region.id;
    });

    afterAll(async () => {
      await db?.query(`DELETE FROM users WHERE display_name = 'e2e-live'`);
      await app?.close();
    });

    it('tổng hợp danh sách: Tavily + Gemini + ghép Google', async () => {
      const started = Date.now();
      await app.get(WebPlacesService).refresh(regionId);
      const ms = Date.now() - started;

      const store = app.get(RegionPlaceStore);
      expect((await store.state(regionId))?.status).toBe('ready');
      const rows = await store.list(regionId, null);
      const google = rows.filter((r) => r.location_source === 'google');
      console.table([
        {
          vùng: REGION_KEY,
          'địa điểm': rows.length,
          'ghép Google': google.length,
          'tọa độ AI': rows.length - google.length,
          ms,
        },
      ]);
      // Soát ghép nhầm bằng mắt: tên từ bài viết, loại, nguồn tọa độ.
      console.table(
        rows.map((r) => ({
          tên: r.name,
          loại: r.category,
          'vị trí': r.location_source,
        })),
      );
      expect(rows.length).toBeGreaterThan(0);
    }, 300_000);

    it('đọc danh sách đã lưu: chỉ database', async () => {
      const started = Date.now();
      const res = await request(app.getHttpServer())
        .get(`/api/regions/${regionId}/places`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const ms = Date.now() - started;
      console.log(`GET danh sách: ${res.body.items.length} mục, ${ms} ms`);
      expect(res.body.status).toBe('ready');
      expect(ms).toBeLessThan(CACHED_BUDGET_MS);
    }, 60_000);
  },
);
