import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { OpenDataService } from '../src/modules/open-data/open-data.service.js';
import type { NominatimResult } from '../src/modules/open-data/open-data.types.js';
import { RegionSeeder } from '../src/modules/regions/region-seeder.js';

/** Tìm vùng (F1): điểm đến đã seed, và ghi lại từ khóa không ra kết quả. */
describe('Tìm vùng (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let token: string;
  // Từ khóa riêng cho mỗi lần chạy để bộ đếm không lẫn với lần trước.
  const missQuery = `E2E miss zqxw ${Date.now()}`;
  // Địa danh giả trả từ Nominatim giả (osm_id không đụng dữ liệu thật).
  const TEST_OSM_KEYS = ['osm:N9990000001', 'osm:N9990000002'];
  const nominatimResult = (
    id: number,
    patch: Partial<NominatimResult>,
  ): NominatimResult => ({
    osm_type: 'node',
    osm_id: id,
    lat: '10.45',
    lon: '107.4',
    name: '',
    display_name: '',
    category: 'place',
    type: 'village',
    addresstype: 'village',
    address: { state: 'Thành phố Hồ Chí Minh' },
    ...patch,
  });

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
    await db?.query(`DELETE FROM regions WHERE source_key = ANY($1::text[])`, [
      TEST_OSM_KEYS,
    ]);
    await db?.query(
      `DELETE FROM region_search_misses WHERE search_key LIKE 'e2e miss%' OR search_key = 'da latt'`,
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

  /** Lượt trượt được ghi ở nền sau khi trả kết quả: đợi một chút cho tới khi thấy. */
  const eventually = <T>(check: () => Promise<T>) =>
    vi.waitFor(check, { timeout: 5000, interval: 100 });

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
  ])(
    '"%s" ra điểm đến đã seed "%s" mà không cần tìm online',
    async (q, name) => {
      const res = await search(q);
      expect(res.body.map((r: { name: string }) => r.name)).toContain(name);
    },
  );

  it('từ khóa không ra kết quả được đếm riêng cho danh mục và cho tìm online', async () => {
    let res = await search(missQuery);
    expect(res.body).toEqual([]);
    await eventually(async () =>
      expect(await misses()).toMatchObject({
        sample_query: missQuery,
        catalog_misses: 1,
        online_misses: 0,
      }),
    );

    await search(missQuery);
    res = await search(missQuery, true);
    expect(res.body).toEqual([]);
    await eventually(async () =>
      expect(await misses()).toMatchObject({
        catalog_misses: 2,
        online_misses: 1,
      }),
    );
  });

  it('chỉ khớp gần đúng (dưới ngưỡng) thì ghi lượt khớp yếu kèm kết quả đứng đầu', async () => {
    await db.query(
      `DELETE FROM region_search_misses WHERE search_key = 'da latt'`,
    );
    const res = await search('Đà Lạtt');
    expect(res.body.map((r: { name: string }) => r.name)).toContain('Đà Lạt');

    const row = await eventually(async () => {
      const [found] = (await db.query(
        `SELECT catalog_misses, online_misses, weak_matches, best_match_name, best_score
           FROM region_search_misses WHERE search_key = 'da latt'`,
      )) as Array<{
        catalog_misses: number;
        online_misses: number;
        weak_matches: number;
        best_match_name: string;
        best_score: number;
      }>;
      expect(found).toBeDefined();
      return found;
    });
    expect(row).toMatchObject({
      catalog_misses: 0,
      online_misses: 0,
      weak_matches: 1,
      best_match_name: 'Đà Lạt',
    });
    expect(row.best_score).toBeGreaterThan(0);
    expect(row.best_score).toBeLessThan(0.8);
  });

  it('có kết quả khớp tốt thì không ghi', async () => {
    await search('da lat');
    // Cho một lượt ghi nền (nếu có, do lỗi) kịp chạy trước khi kiểm tra.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const [{ n }] = (await db.query(
      `SELECT count(*)::int AS n FROM region_search_misses WHERE search_key = 'da lat'`,
    )) as Array<{ n: number }>;
    expect(n).toBe(0);
  });
  it('Nominatim: câu có dấu không ra gì thì thử bản không dấu; kết quả là xã thì không nhập', async () => {
    const spy = vi.spyOn(app.get(OpenDataService), 'searchPlaces');
    spy.mockReset();
    spy.mockImplementation(async (q: string) =>
      q === 'Bai Kem Thu Nghiem'
        ? [
            nominatimResult(9990000001, { name: 'Bãi Kem Thử Nghiệm' }),
            nominatimResult(9990000002, {
              name: 'Xã Thử Nghiệm Mới',
              category: 'boundary',
              addresstype: 'town',
            }),
          ]
        : [],
    );
    try {
      const res = await search('Bãi Kem Thử Nghiệm', true);
      expect(spy.mock.calls.map(([q]) => q)).toEqual([
        'Bãi Kem Thử Nghiệm',
        'Bai Kem Thu Nghiem',
      ]);
      expect(res.body.map((r: { name: string }) => r.name)).toContain(
        'Bãi Kem Thử Nghiệm',
      );
      const [{ n }] = (await db.query(
        `SELECT count(*)::int AS n FROM regions WHERE source_key = $1`,
        [TEST_OSM_KEYS[1]],
      )) as Array<{ n: number }>;
      expect(n).toBe(0);
    } finally {
      spy.mockReset();
      spy.mockResolvedValue([]);
    }
  });

  describe('xã/phường sau sáp nhập', () => {
    type Hit = {
      name: string;
      parent: { id: string; displayName: string } | null;
    };

    it.each(['phuoc hai', 'Phước Hải', 'xa phuoc hai', 'Xã Phước Hải'])(
      '"%s" ra Xã Phước Hải thuộc TP.HCM ở đầu, không gọi Nominatim',
      async (q) => {
        const spy = vi.spyOn(app.get(OpenDataService), 'searchPlaces');
        spy.mockClear();
        const res = await search(q, true);
        const top = res.body[0] as Hit;
        expect(top.name).toBe('Xã Phước Hải');
        expect(top.parent?.displayName).toContain('Hồ Chí Minh');
        expect(spy).not.toHaveBeenCalled();
      },
    );

    it('"long hai" ra Xã Long Hải', async () => {
      const res = await search('long hai');
      expect((res.body[0] as Hit).name).toBe('Xã Long Hải');
    });

    it('"vung tau": điểm đến Vũng Tàu đứng trước Phường Vũng Tàu', async () => {
      const names = (await search('vung tau')).body.map((r: Hit) => r.name);
      const ward = names.findIndex((n: string) =>
        n.startsWith('Phường Vũng Tàu'),
      );
      expect(ward).toBeGreaterThan(-1);
      expect(names.indexOf('Vũng Tàu')).toBeGreaterThan(-1);
      expect(names.indexOf('Vũng Tàu')).toBeLessThan(ward);
    });

    it('xã trùng tên ở hai tỉnh đều xuất hiện, mỗi kết quả kèm tỉnh', async () => {
      const [row] = (await db.query(
        `SELECT name FROM regions WHERE source_key LIKE 'vn:ward:%'
          GROUP BY name HAVING count(DISTINCT parent_id) = 2 ORDER BY name LIMIT 1`,
      )) as Array<{ name: string }>;
      const hits = ((await search(row.name)).body as Hit[]).filter(
        (r) => r.name === row.name,
      );
      expect(hits).toHaveLength(2);
      expect(hits.every((h) => h.parent !== null)).toBe(true);
      expect(new Set(hits.map((h) => h.parent!.id)).size).toBe(2);
    });

    it('seed có đủ 3.321 xã; seed lần hai bỏ qua', async () => {
      const [{ n }] = (await db.query(
        `SELECT count(*)::int AS n FROM regions WHERE source_key LIKE 'vn:ward:%'`,
      )) as Array<{ n: number }>;
      expect(n).toBe(3321);
      const seeder = app.get(RegionSeeder);
      const log = vi.spyOn(
        (seeder as unknown as { logger: { log: (m: string) => void } }).logger,
        'log',
      );
      await seeder.onApplicationBootstrap();
      expect(
        log.mock.calls.some(([m]) => String(m).includes('bỏ qua seed xã')),
      ).toBe(true);
    });
  });
});
