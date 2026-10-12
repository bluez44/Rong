import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { OpenDataService } from '../src/modules/open-data/open-data.service.js';

/** Tìm vùng (F1): điểm đến đã seed, và ghi lại từ khóa không ra kết quả. */
describe('Tìm vùng (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let token: string;
  // Từ khóa riêng cho mỗi lần chạy để bộ đếm không lẫn với lần trước.
  const missQuery = `E2E miss zqxw ${Date.now()}`;

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
      `INSERT INTO users (display_name) VALUES ('e2e-region-search') RETURNING id`,
    )) as Array<{ id: string }>;
    token = app.get(JwtService).sign({ sub: user.id });
    // Không gọi Nominatim thật: tìm online không ra gì.
    vi.spyOn(app.get(OpenDataService), 'searchPlaces').mockResolvedValue([]);
  });

  afterAll(async () => {
    await db?.query(
      `DELETE FROM region_search_misses WHERE search_key LIKE 'e2e miss%'`,
    );
    await db?.query(
      `DELETE FROM users WHERE display_name = 'e2e-region-search'`,
    );
    await app?.close();
  });

  const search = (q: string, online = false) =>
    request(app.getHttpServer())
      .get('/api/regions/search')
      .query(online ? { q, online: 'true' } : { q })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

  const misses = async () => {
    const [row] = (await db.query(
      `SELECT sample_query, catalog_misses, online_misses
         FROM region_search_misses WHERE search_key = lower($1)`,
      [missQuery],
    )) as Array<{
      sample_query: string;
      catalog_misses: number;
      online_misses: number;
    }>;
    return row;
  };

  it.each([
    ['can gio', 'Cần Giờ'],
    ['Củ Chi', 'Củ Chi'],
    ['trang an', 'Tam Cốc – Tràng An'],
    ['moc chau', 'Mộc Châu'],
    ['ly son', 'Lý Sơn'],
  ])('"%s" ra điểm đến đã seed "%s" mà không cần tìm online', async (q, name) => {
    const res = await search(q);
    expect(res.body.map((r: { name: string }) => r.name)).toContain(name);
  });

  it('từ khóa không ra kết quả được đếm riêng cho danh mục và cho tìm online', async () => {
    let res = await search(missQuery);
    expect(res.body).toEqual([]);
    expect(await misses()).toMatchObject({
      sample_query: missQuery,
      catalog_misses: 1,
      online_misses: 0,
    });

    await search(missQuery);
    res = await search(missQuery, true);
    expect(res.body).toEqual([]);
    expect(await misses()).toMatchObject({
      catalog_misses: 2,
      online_misses: 1,
    });
  });

  it('có kết quả thì không ghi', async () => {
    await search('da lat');
    const [{ n }] = (await db.query(
      `SELECT count(*)::int AS n FROM region_search_misses WHERE search_key = 'da lat'`,
    )) as Array<{ n: number }>;
    expect(n).toBe(0);
  });
});
