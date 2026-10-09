import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/**
 * Đo tốc độ thật: gọi Overpass, Tavily, Gemini, Google thật (tốn tiền, kết
 * quả dao động theo mạng), nên không nằm trong `pnpm test:e2e`. Chạy bằng
 * `pnpm bench:places`; đổi vùng bằng PLACES_LIVE_REGION (source_key), mặc
 * định Đà Lạt. Lần chạy v1 đầu tiên có thể tải thật từ OSM và lưu vào DB
 * như khi người dùng mở vùng.
 *
 * Ngưỡng chỉ đặt cho các lần đã có cache (không phụ thuộc dịch vụ ngoài);
 * lần đầu chỉ ghi lại thời gian để so sánh giữa các lần chạy.
 */
const REGION_KEY = process.env.PLACES_LIVE_REGION ?? 'vn:destination:da-lat';
const CACHED_BUDGET_MS = 3000;

describe.skipIf(!process.env.TAVILY_API_KEY || !process.env.GEMINI_API_KEY)(
  `Tốc độ thật: ${REGION_KEY}`,
  () => {
    let app: INestApplication;
    let db: DataSource;
    let token: string;
    let regionId: string;
    const timings: Array<{
      bước: string;
      ms: number;
      mục: number;
      nguồn: string;
    }> = [];

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

    // Có thể phải chờ một lượt tải OSM ở nền đang chạy dở trước khi đóng app.
    afterAll(async () => {
      if (timings.length > 0) console.table(timings);
      await db?.query(`DELETE FROM users WHERE display_name = 'e2e-live'`);
      await app?.close();
    }, 300_000);

    async function measure(step: string, path: string) {
      const started = Date.now();
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${token}`);
      const ms = Date.now() - started;
      const source = (response.body.source as string | undefined) ?? '?';
      timings.push({
        bước: step,
        ms,
        mục: response.body.items?.length ?? 0,
        nguồn: source,
      });
      expect(response.status).toBe(200);
      return { response, ms, source };
    }

    it('v1 lần đầu trong phiên (có thể tải từ OSM nếu vùng chưa có)', async () => {
      const { response } = await measure(
        'v1 lần đầu',
        `/api/regions/${regionId}/places?limit=20`,
      );
      expect(response.body.items.length).toBeGreaterThan(0);
    }, 600_000);

    it('v1 lần sau: chỉ database (khi đã có danh mục)', async () => {
      const { ms, source } = await measure(
        'v1 lần sau',
        `/api/regions/${regionId}/places?limit=20`,
      );
      // OSM chưa tải được (Overpass lỗi/chậm) thì lần này vẫn là dự phòng
      // Gemini, không đo được tốc độ danh mục: chỉ ghi lại.
      if (source === 'catalog') expect(ms).toBeLessThan(CACHED_BUDGET_MS);
      else
        console.warn(
          `v1 lần sau vẫn dùng nguồn "${source}" (OSM chưa tải được)`,
        );
    }, 120_000);

    it('v2 lần đầu: Tavily + Gemini + Geocoding', async () => {
      const { response } = await measure(
        'v2 lần đầu',
        `/api/v2/regions/${regionId}/places`,
      );
      expect(response.body.items.length).toBeGreaterThan(0);
    }, 120_000);

    it('v2 lần sau: cache kết quả tìm và tọa độ', async () => {
      const { ms } = await measure(
        'v2 lần sau',
        `/api/v2/regions/${regionId}/places`,
      );
      expect(ms).toBeLessThan(CACHED_BUDGET_MS);
    }, 60_000);

    it('v2 đổi bộ lọc', async () => {
      const { ms } = await measure(
        'v2 đổi bộ lọc',
        `/api/v2/regions/${regionId}/places?categories=food,cafe`,
      );
      expect(ms).toBeLessThan(CACHED_BUDGET_MS);
    }, 60_000);
  },
);
