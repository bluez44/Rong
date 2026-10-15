import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PlaceSearchService as AgentPlaceSearch } from '../src/langchain/place-search.service.js';
import { GooglePlacesService } from '../src/modules/google/google-places.service.js';
import { GoogleLocationJanitor } from '../src/modules/places/google-location-janitor.js';
import { PlaceLocationService } from '../src/modules/places/place-location.service.js';
import {
  RegionPlaceStore,
  type WebPlaceInput,
} from '../src/modules/places/region-place-store.js';
import { WEB_PLACES_CONFIG } from '../src/modules/places/web-places.service.js';

/** Dòng `web` của danh sách địa điểm từ bài viết (spec 2026-10-14). */
describe('Địa điểm từ bài viết (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let regionId: string;
  let token: string;

  const google = {
    enabled: true,
    findPlace: vi.fn(),
    locate: vi.fn(),
    searchByName: vi.fn(async () => []),
    searchText: vi.fn(async () => []),
    details: vi.fn(async () => null),
    preview: vi.fn(),
    summary: vi.fn(async () => null),
  };
  const agent = { enabled: true, findPlaces: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GooglePlacesService)
      .useValue(google)
      .overrideProvider(AgentPlaceSearch)
      .useValue(agent)
      .overrideProvider(WEB_PLACES_CONFIG)
      .useValue({ refreshDays: 30, waitMs: 2000 })
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
    // Vùng riêng cho test: các e2e chạy song song trên cùng DB nên không dùng vùng thật.
    const [region] = (await db.query(
      `INSERT INTO regions (source_key, name, type, boundary_version, search_name, bbox_south, bbox_west, bbox_north, bbox_east)
       VALUES ('e2e:web-places', 'Vùng e2e web places', 'destination', 'current', 'vung e2e web places', 11.85, 108.35, 12.05, 108.55)
       ON CONFLICT (source_key) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    )) as Array<{ id: string }>;
    regionId = region.id;
    const [user] = (await db.query(
      `INSERT INTO users (display_name) VALUES ('e2e-web-places') RETURNING id`,
    )) as Array<{ id: string }>;
    token = app.get(JwtService).sign({ sub: user.id });
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
    await db?.query(
      `DELETE FROM itineraries WHERE owner_id IN (SELECT id FROM users WHERE display_name = 'e2e-web-places')`,
    );
    await db?.query(`DELETE FROM places WHERE name LIKE 'E2E wp %'`);
    await db?.query(`DELETE FROM regions WHERE source_key = 'e2e:web-places'`);
    await db?.query(`DELETE FROM users WHERE display_name = 'e2e-web-places'`);
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

      await expect(app.get(PlaceLocationService).ensure([id])).resolves.toEqual(
        [],
      );

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
      await expect(webRow('E2E wp trùng 2', 'wp-dup', 30)).rejects.toThrow(
        /uq_place_google/,
      );
    });
  });
  describe('RegionPlaceStore', () => {
    const article = {
      title: 'Bài A',
      uri: 'https://a.test/1',
      publishedAt: null,
    };
    const input = (
      name: string,
      location: WebPlaceInput['location'],
    ): WebPlaceInput => ({
      name,
      category: 'nature',
      address: null,
      description: 'Mô tả',
      openingHours: '07:00-17:00',
      articles: [article],
      location,
    });

    beforeEach(async () => {
      await db.query(`DELETE FROM region_places WHERE region_id = $1`, [
        regionId,
      ]);
      await db.query(`DELETE FROM region_place_lists WHERE region_id = $1`, [
        regionId,
      ]);
    });

    it('lưu danh sách theo thứ tự, đánh dấu ready và hạn làm mới', async () => {
      const store = app.get(RegionPlaceStore);
      const ids = await store.replace(
        regionId,
        [
          input('E2E wp Thác A', {
            source: 'google',
            placeId: 'wp-a',
            lat: 11.9,
            lng: 108.44,
          }),
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
      expect(state!.expiresAt!.getTime()).toBeGreaterThan(
        Date.now() + 29 * 86_400_000,
      );
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
        [
          input('E2E wp Tên bài viết', {
            source: 'google',
            placeId: 'wp-saved',
            lat: 11.94,
            lng: 108.44,
          }),
        ],
        [],
        30,
      );

      expect(id).toBe(saved.id);
      const [row] = (await db.query(`SELECT name FROM places WHERE id = $1`, [
        id,
      ])) as Array<{ name: string }>;
      expect(row.name).toBe('E2E wp Tên người dùng');
    });

    it('làm mới: dòng AI cùng tên được dùng lại, ghép được Google thì nâng cấp chính dòng đó', async () => {
      const store = app.get(RegionPlaceStore);
      const [first] = await store.replace(
        regionId,
        [input('E2E wp Hồ C', { source: 'ai', lat: 11.93, lng: 108.43 })],
        [],
        30,
      );
      const [again] = await store.replace(
        regionId,
        [input('E2E wp Hồ C', { source: 'ai', lat: 11.93, lng: 108.43 })],
        [],
        30,
      );
      expect(again).toBe(first);

      const [upgraded] = await store.replace(
        regionId,
        [
          input('E2E wp Hồ C', {
            source: 'google',
            placeId: 'wp-c',
            lat: 11.931,
            lng: 108.431,
          }),
        ],
        [],
        30,
      );
      expect(upgraded).toBe(first);
      const [row] = (await db.query(
        `SELECT location_source, google_place_id, location_expires_at IS NOT NULL AS expires FROM places WHERE id = $1`,
        [first],
      )) as Array<{
        location_source: string;
        google_place_id: string;
        expires: boolean;
      }>;
      expect(row).toEqual({
        location_source: 'google',
        google_place_id: 'wp-c',
        expires: true,
      });
    });

    it('list lọc theo danh mục', async () => {
      const store = app.get(RegionPlaceStore);
      await store.replace(
        regionId,
        [
          input('E2E wp Thác D', { source: 'ai', lat: 11.9, lng: 108.4 }),
          {
            ...input('E2E wp Quán E', { source: 'ai', lat: 11.9, lng: 108.4 }),
            category: 'food',
          },
        ],
        [],
        30,
      );
      expect((await store.list(regionId, ['food'])).map((r) => r.name)).toEqual(
        ['E2E wp Quán E'],
      );
    });
  });

  describe('GET /regions/:id/places', () => {
    const article = (n: number, body: string) => ({
      title: `Bài ${n}`,
      uri: `https://wp.test/${n}`,
      content: body,
      publishedAt: '2026-01-01',
    });
    const agentPlace = (title: string, category: string) => ({
      title,
      description: `${title} đẹp`,
      address: '',
      location: { lat: 11.94, lng: 108.44, address: '' },
      category,
      openHours: { open: '07:00', close: '17:00' },
    });
    const get = (query = '') =>
      request(app.getHttpServer())
        .get(`/api/regions/${regionId}/places${query}`)
        .set('Authorization', `Bearer ${token}`);
    const names = (body: { items: Array<{ name: string }> }) =>
      body.items.map((i) => i.name);

    beforeEach(async () => {
      await db.query(`DELETE FROM region_places WHERE region_id = $1`, [
        regionId,
      ]);
      await db.query(`DELETE FROM region_place_lists WHERE region_id = $1`, [
        regionId,
      ]);
      agent.findPlaces.mockReset();
      google.findPlace.mockReset();
    });

    it('lần đầu: chạy pipeline, lưu, trả mục có id; ghép được thì google, không thì ai', async () => {
      agent.findPlaces.mockResolvedValue({
        places: [
          agentPlace('E2E wp Thác Một', 'nature'),
          agentPlace('E2E wp Quán Hai', 'food'),
        ],
        sources: [article(1, 'Ghé E2E wp Thác Một rồi ăn ở E2E wp Quán Hai.')],
      });
      google.findPlace.mockImplementation(async (query: string) =>
        query.startsWith('E2E wp Thác Một')
          ? [
              {
                placeId: 'wp-g1',
                lat: 11.9,
                lng: 108.44,
                name: 'E2E wp Thác Một',
                primaryType: 'tourist_attraction',
              },
            ]
          : [],
      );

      const res = await get('?categories=nature,food').expect(200);

      expect(res.body.status).toBe('ready');
      expect(res.body.source).toBe('web');
      expect(
        res.body.items.map(
          (i: {
            name: string;
            locationSource: string;
            googlePlaceId: string | null;
          }) => [i.name, i.locationSource, i.googlePlaceId ?? null],
        ),
      ).toEqual([
        ['E2E wp Thác Một', 'google', 'wp-g1'],
        ['E2E wp Quán Hai', 'ai', null],
      ]);
      expect(
        res.body.items.every((i: { id: string }) => typeof i.id === 'string'),
      ).toBe(true);
      expect(res.body.items[0].articles[0].uri).toBe('https://wp.test/1');

      // Màn chi tiết cũng trả bài viết nguồn (từ danh sách của vùng).
      const detail = await request(app.getHttpServer())
        .get(`/api/places/${res.body.items[1].id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.articles.map((a: { uri: string }) => a.uri)).toEqual([
        'https://wp.test/1',
      ]);
    });

    it('bỏ địa điểm không có trong bài viết nào', async () => {
      agent.findPlaces.mockResolvedValue({
        places: [
          agentPlace('E2E wp Có Thật', 'nature'),
          agentPlace('E2E wp Bịa', 'nature'),
        ],
        sources: [article(2, 'Nên đến E2E wp Có Thật.')],
      });
      google.findPlace.mockResolvedValue([]);
      const res = await get().expect(200);
      expect(names(res.body)).toEqual(['E2E wp Có Thật']);
    });

    it('hai request song song chỉ chạy một lượt pipeline', async () => {
      agent.findPlaces.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 300));
        return {
          places: [agentPlace('E2E wp Song Song', 'nature')],
          sources: [article(3, 'E2E wp Song Song')],
        };
      });
      google.findPlace.mockResolvedValue([]);
      const [a, b] = await Promise.all([get().expect(200), get().expect(200)]);
      expect(agent.findPlaces).toHaveBeenCalledTimes(1);
      expect(a.body.items).toHaveLength(1);
      expect(b.body.items).toHaveLength(1);
    });

    it('quá thời gian chờ thì trả building, lần sau có kết quả', async () => {
      agent.findPlaces.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 2500));
        return {
          places: [agentPlace('E2E wp Chậm', 'nature')],
          sources: [article(4, 'E2E wp Chậm')],
        };
      });
      google.findPlace.mockResolvedValue([]);
      const first = await get().expect(200);
      expect(first.body).toMatchObject({ status: 'building', items: [] });
      await new Promise((r) => setTimeout(r, 1000));
      const second = await get().expect(200);
      expect(second.body.status).toBe('ready');
      expect(names(second.body)).toEqual(['E2E wp Chậm']);
    });

    it('pipeline lỗi khi đã có danh sách cũ: vẫn trả danh sách cũ', async () => {
      agent.findPlaces.mockResolvedValueOnce({
        places: [agentPlace('E2E wp Cũ', 'nature')],
        sources: [article(5, 'E2E wp Cũ')],
      });
      google.findPlace.mockResolvedValue([]);
      await get().expect(200);
      await db.query(
        `UPDATE region_place_lists SET expires_at = now() - interval '1 day' WHERE region_id = $1`,
        [regionId],
      );
      agent.findPlaces.mockRejectedValueOnce(new Error('Tavily sập'));

      const res = await get().expect(200);
      expect(names(res.body)).toEqual(['E2E wp Cũ']);
      await new Promise((r) => setTimeout(r, 200)); // làm mới nền chạy xong
      expect(agent.findPlaces).toHaveBeenCalledTimes(2);
      const [state] = (await db.query(
        `SELECT status FROM region_place_lists WHERE region_id = $1`,
        [regionId],
      )) as Array<{ status: string }>;
      expect(state.status).toBe('ready');
    });

    it('pipeline lỗi và chưa có gì: 503 PLACES_UNAVAILABLE', async () => {
      agent.findPlaces.mockRejectedValue(new Error('Tavily sập'));
      const res = await get().expect(503);
      expect(res.body.code).toBe('PLACES_UNAVAILABLE');
    });

    it('Google lỗi: mọi địa điểm dùng tọa độ AI, danh sách vẫn lưu', async () => {
      agent.findPlaces.mockResolvedValue({
        places: [agentPlace('E2E wp Không Google', 'nature')],
        sources: [article(6, 'E2E wp Không Google')],
      });
      google.findPlace.mockRejectedValue(new Error('500'));
      const res = await get().expect(200);
      expect(res.body.items[0].locationSource).toBe('ai');
    });

    it('vùng không tồn tại: 404 REGION_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/regions/00000000-0000-4000-8000-000000000000/places')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(res.body.code).toBe('REGION_NOT_FOUND');
    });
  });

  describe('GET /places/:id', () => {
    it('dòng web tọa độ AI: không gọi Google, link tìm trên Google Maps, ghi rõ nguồn', async () => {
      const id = await webRow('E2E wp Chi tiết AI', null, null);
      const res = await request(app.getHttpServer())
        .get(`/api/places/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        id,
        name: 'E2E wp Chi tiết AI',
        locationSource: 'ai',
        googleStatus: 'not_found',
        google: null,
        attribution: 'Tổng hợp từ bài viết (AI) · Google Maps',
      });
      expect(res.body.sourceUrl).toMatch(
        /^https:\/\/www\.google\.com\/maps\/search\//,
      );
      expect(google.details).not.toHaveBeenCalled();
    });

    it('dòng web đã ghép Google: nội dung Google trực tiếp, giữ tên từ bài viết', async () => {
      const id = await webRow('E2E wp Chi tiết Google', 'wp-detail', 30);
      google.details.mockResolvedValueOnce({
        placeId: 'wp-detail',
        name: 'Tên Google',
        googleMapsUri: 'https://maps.google.com/?cid=1',
      } as never);
      const res = await request(app.getHttpServer())
        .get(`/api/places/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'E2E wp Chi tiết Google',
        locationSource: 'google',
        googleStatus: 'ok',
        sourceUrl: 'https://maps.google.com/?cid=1',
      });
      expect(google.details).toHaveBeenCalledWith('wp-detail');
    });
  });

  describe('dòng OSM cũ', () => {
    const osmRow = async (): Promise<string> => {
      const [row] = (await db.query(
        `INSERT INTO places (osm_type, osm_id, name, category, location, composite_score)
         VALUES ('node', -97001, 'E2E wp OSM cũ', 'nature', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 50)
         ON CONFLICT (osm_type, osm_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
      )) as Array<{ id: string }>;
      return row.id;
    };

    it('GET /places/:id vẫn trả chi tiết của dòng osm đã có, không gọi Google', async () => {
      const id = await osmRow();
      const res = await request(app.getHttpServer())
        .get(`/api/places/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        id,
        name: 'E2E wp OSM cũ',
        locationSource: 'osm',
        googleStatus: 'not_found',
      });
      expect(google.details).not.toHaveBeenCalled();
    });

    it('lịch trình tham chiếu dòng osm vẫn tạo và đọc lại được', async () => {
      const id = await osmRow();
      const created = await request(app.getHttpServer())
        .post('/api/itineraries')
        .set('Authorization', `Bearer ${token}`)
        .send({
          regionId,
          planningMode: 'manual',
          startsAt: '2026-10-05T08:00:00+07:00',
          endsAt: '2026-10-05T18:00:00+07:00',
          travelParty: 'friends',
          adults: 2,
          children: 0,
          selectedPlaceIds: [id],
        })
        .expect(201);
      const res = await request(app.getHttpServer())
        .get(`/api/itineraries/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.unscheduled).toEqual([
        expect.objectContaining({ placeId: id, name: 'E2E wp OSM cũ' }),
      ]);
    });
  });
});
