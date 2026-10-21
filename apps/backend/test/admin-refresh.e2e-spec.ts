import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AppModule } from '../src/app.module.js';
import type { AdminConfig } from '../src/config/configuration.js';
import { PlaceSearchService as AgentPlaceSearch } from '../src/langchain/place-search.service.js';
import { ADMIN_CONFIG } from '../src/modules/admin/admin.guard.js';
import { AdminRefreshLimiter } from '../src/modules/admin/admin-refresh-limiter.js';
import { GooglePlacesService } from '../src/modules/google/google-places.service.js';
import {
  WEB_PLACES_CONFIG,
  WebPlacesService,
  type RefreshOutcome,
} from '../src/modules/places/web-places.service.js';

const KEY = 'e2e-admin-key-'.padEnd(48, 'x');
const ADMIN_EMAIL = 'admin-e2e@rong.test';
const MINUTE = 60_000;
const runs: Array<Promise<RefreshOutcome>> = [];

/** Reset địa điểm của vùng: chỉ admin (JWT + email đã xác minh + khóa), có giới hạn tần suất. */
describe('POST /regions/:id/places/refresh (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let regionId: string;
  const tokens: Record<'admin' | 'user' | 'unverified', string> = {
    admin: '',
    user: '',
    unverified: '',
  };

  // Cấu hình đổi được giữa các test (tắt/bật route).
  const admin: AdminConfig = {
    emails: [ADMIN_EMAIL, 'chua-xac-minh@rong.test'],
    apiKey: KEY,
    refreshDailyLimit: 3,
  };
  let now = Date.now();
  const limiter = new AdminRefreshLimiter(admin.refreshDailyLimit, () => now);
  const agent = {
    enabled: true,
    findPlaces: vi.fn(),
    findMorePlaces: vi.fn(async () => ({ places: [], sources: [] })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentPlaceSearch)
      .useValue(agent)
      .overrideProvider(GooglePlacesService)
      .useValue({ enabled: false, findPlace: vi.fn(async () => []) })
      .overrideProvider(WEB_PLACES_CONFIG)
      .useValue({
        refreshDays: 30,
        waitMs: 2000,
        minCount: 3,
        googleMatch: false,
      })
      .overrideProvider(ADMIN_CONFIG)
      .useValue(admin)
      .overrideProvider(AdminRefreshLimiter)
      .useValue(limiter)
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

    // Route trả 202 trước khi pipeline xong: ghi lại mọi lượt để test đợi được, và để lượt nền của test này
    // không chạy lấn sang test sau.
    const service = app.get(WebPlacesService);
    const original = service.refresh.bind(service);
    service.refresh = (...args) => {
      const run = original(...args);
      runs.push(run);
      return run;
    };

    const [region] = (await db.query(
      `INSERT INTO regions (source_key, name, type, boundary_version, search_name, bbox_south, bbox_west, bbox_north, bbox_east)
       VALUES ('e2e:admin-refresh', 'Vùng e2e admin', 'destination', 'current', 'vung e2e admin', 11.85, 108.35, 12.05, 108.55)
       ON CONFLICT (source_key) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    )) as Array<{ id: string }>;
    regionId = region.id;

    const user = async (email: string, verified: boolean) => {
      const [row] = (await db.query(
        `INSERT INTO users (display_name) VALUES ('e2e-admin-refresh') RETURNING id`,
      )) as Array<{ id: string }>;
      await db.query(
        `INSERT INTO auth_identities (user_id, provider, provider_account_id, email, email_verified_at, password_hash)
         VALUES ($1, 'password', $2, $2, CASE WHEN $3::boolean THEN now() END, 'x')`,
        [row.id, email, verified],
      );
      return app.get(JwtService).sign({ sub: row.id });
    };
    tokens.admin = await user(ADMIN_EMAIL, true);
    tokens.user = await user('khach-e2e@rong.test', true);
    tokens.unverified = await user('chua-xac-minh@rong.test', false);
  });

  afterAll(async () => {
    if (regionId) {
      await db?.query(`DELETE FROM region_places WHERE region_id = $1`, [
        regionId,
      ]);
      await db?.query(`DELETE FROM region_place_lists WHERE region_id = $1`, [
        regionId,
      ]);
    }
    await db?.query(`DELETE FROM places WHERE name LIKE 'E2E ar %'`);
    await db?.query(
      `DELETE FROM regions WHERE source_key = 'e2e:admin-refresh'`,
    );
    await db?.query(
      `DELETE FROM users WHERE display_name = 'e2e-admin-refresh'`,
    );
    await app?.close();
  });

  const article = (body: string) => ({
    title: 'Bài e2e',
    uri: 'https://ar.test/1',
    content: body,
    publishedAt: '2026-01-01',
    images: [],
  });
  const found = (...names: string[]) => ({
    places: names.map((title) => ({
      title,
      description: `${title} đẹp`,
      address: '',
      location: { lat: 11.94, lng: 108.44 },
      category: 'nature',
      openHours: { open: '07:00', close: '17:00' },
    })),
    sources: [article(names.join(', '))],
  });
  const post = (
    who: keyof typeof tokens | null = 'admin',
    key: string | null = KEY,
    id = regionId,
  ) => {
    const req = request(app.getHttpServer()).post(
      `/api/regions/${id}/places/refresh`,
    );
    if (who) req.set('Authorization', `Bearer ${tokens[who]}`);
    if (key !== null) req.set('X-Admin-Key', key);
    return req;
  };
  const names = async () =>
    (
      (await db.query(
        `SELECT p.name FROM region_places rp JOIN places p ON p.id = rp.place_id
          WHERE rp.region_id = $1 ORDER BY rp.rank`,
        [regionId],
      )) as Array<{ name: string }>
    ).map((r) => r.name);
  /** Kết quả lượt pipeline mà request vừa khởi động. */
  const settle = () => runs.at(-1)!;

  afterEach(async () => {
    await Promise.all(runs.splice(0));
  });

  beforeEach(async () => {
    agent.findPlaces.mockReset();
    agent.enabled = true;
    admin.emails = [ADMIN_EMAIL, 'chua-xac-minh@rong.test'];
    admin.apiKey = KEY;
    // Qua hết cửa sổ của bộ đếm: mỗi test bắt đầu với hạn mức đầy đủ.
    now += 25 * 60 * MINUTE;
    await db.query(`DELETE FROM region_places WHERE region_id = $1`, [
      regionId,
    ]);
    await db.query(`DELETE FROM region_place_lists WHERE region_id = $1`, [
      regionId,
    ]);
  });

  describe('bảo mật', () => {
    it('thiếu ADMIN_API_KEY: 404 như không có route', async () => {
      admin.apiKey = null;
      await post().expect(404);
    });

    it('thiếu ADMIN_EMAILS: 404', async () => {
      admin.emails = [];
      await post().expect(404);
    });

    it('không có JWT: 401', async () => {
      await post(null).expect(401);
    });

    it('không phải admin: 404', async () => {
      await post('user').expect(404);
    });

    it('email admin chưa xác minh: 404', async () => {
      await post('unverified').expect(404);
    });

    it.each([
      ['sai khóa', 'sai'.padEnd(48, 'x')],
      ['thiếu khóa', null],
    ])('%s: 404', async (_name, key) => {
      await post('admin', key).expect(404);
    });

    it('bị từ chối thì không chạy pipeline', async () => {
      await post('user').expect(404);
      await post('admin', 'sai').expect(404);
      expect(agent.findPlaces).not.toHaveBeenCalled();
    });
  });

  describe('chạy lại pipeline', () => {
    it('202 ngay; bản mới thay bản cũ kể cả khi ít địa điểm hơn', async () => {
      agent.findPlaces.mockResolvedValueOnce(
        found('E2E ar Cũ Một', 'E2E ar Cũ Hai', 'E2E ar Cũ Ba'),
      );
      await app.get(WebPlacesService).refresh(regionId);
      expect(await names()).toHaveLength(3);

      agent.findPlaces.mockResolvedValueOnce(found('E2E ar Mới Một'));
      const res = await post().expect(202);
      expect(res.body).toEqual({ status: 'building' });

      await expect(settle()).resolves.toMatchObject({
        result: 'replaced',
        count: 1,
      });
      expect(await names()).toEqual(['E2E ar Mới Một']);
    });

    it('ra 0 địa điểm thì giữ bản cũ', async () => {
      agent.findPlaces.mockResolvedValueOnce(
        found('E2E ar Giữ Một', 'E2E ar Giữ Hai'),
      );
      await app.get(WebPlacesService).refresh(regionId);

      agent.findPlaces.mockResolvedValueOnce({ places: [], sources: [] });
      await post().expect(202);

      await expect(settle()).resolves.toMatchObject({ result: 'kept' });
      expect(await names()).toEqual(['E2E ar Giữ Một', 'E2E ar Giữ Hai']);
    });

    it('pipeline lỗi thì giữ bản cũ', async () => {
      agent.findPlaces.mockResolvedValueOnce(found('E2E ar Lỗi Một'));
      await app.get(WebPlacesService).refresh(regionId);

      agent.findPlaces.mockRejectedValueOnce(new Error('Tavily sập'));
      await post().expect(202);

      await expect(settle()).resolves.toMatchObject({ result: 'failed' });
      expect(await names()).toEqual(['E2E ar Lỗi Một']);
    });

    it('vùng không tồn tại: 404 REGION_NOT_FOUND, không tính lượt', async () => {
      const res = await post(
        'admin',
        KEY,
        '00000000-0000-4000-8000-000000000000',
      ).expect(404);
      expect(res.body.code).toBe('REGION_NOT_FOUND');
      agent.findPlaces.mockResolvedValue(found('E2E ar Sau 404'));
      await post().expect(202);
    });

    it('thiếu Tavily: 503 PLACES_UNAVAILABLE', async () => {
      agent.enabled = false;
      const res = await post().expect(503);
      expect(res.body.code).toBe('PLACES_UNAVAILABLE');
    });
  });

  describe('giới hạn tần suất', () => {
    it('cùng vùng trong 10 phút: 429', async () => {
      agent.findPlaces.mockResolvedValue(found('E2E ar Nhịp Một'));
      await post().expect(202);
      await settle();

      const res = await post().expect(429);
      expect(res.body.code).toBe('REFRESH_RATE_LIMITED');
      expect(agent.findPlaces).toHaveBeenCalledTimes(1);

      now += 10 * MINUTE;
      await post().expect(202);
    });

    it('quá hạn mức trong ngày: 429', async () => {
      agent.findPlaces.mockResolvedValue(found('E2E ar Ngày Một'));
      for (let i = 0; i < admin.refreshDailyLimit; i++) {
        await post().expect(202);
        now += 10 * MINUTE;
      }
      const res = await post().expect(429);
      expect(res.body.code).toBe('REFRESH_RATE_LIMITED');
    });
  });
});
