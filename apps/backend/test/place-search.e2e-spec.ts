import { randomUUID } from 'node:crypto';

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
import {
  GooglePlacesService,
  GoogleUnavailableError,
} from '../src/modules/google/google-places.service.js';
import { PLACE_SEARCH_CONFIG } from '../src/modules/places/place-search.service.js';

/** Tìm địa điểm theo tên trong một vùng, xem trước và lưu kết quả Google. */
describe('Tìm địa điểm (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let token: string;
  let otherToken: string;
  let otherUserId: string;
  let detailsToken: string;
  let daLat: string;
  let webReu: string;
  let otherGoogleRow: string;

  const google = {
    enabled: true,
    searchByName: vi.fn(),
    preview: vi.fn(),
    locate: vi.fn(),
    details: vi.fn(async () => null),
    searchText: vi.fn(async () => []),
    summary: vi.fn(async () => null),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GooglePlacesService)
      .useValue(google)
      .overrideProvider(PLACE_SEARCH_CONFIG)
      .useValue({ dailyLimit: 3, detailsDailyLimit: 5 })
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
    const jwt = app.get(JwtService);
    const [user, other, details] = (await db.query(
      `INSERT INTO users (display_name)
       VALUES ('e2e-place-search'), ('e2e-place-search-other'), ('e2e-place-search-details')
       RETURNING id`,
    )) as Array<{ id: string }>;
    token = jwt.sign({ sub: user.id });
    detailsToken = jwt.sign({ sub: details.id });
    otherToken = jwt.sign({ sub: other.id });
    otherUserId = other.id;

    const [region] = (await db.query(
      `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
    )) as Array<{ id: string }>;
    daLat = region.id;

    // Lần chạy trước bị ngắt có thể còn sót dòng (place_id là duy nhất).
    await db.query(
      `DELETE FROM places WHERE name LIKE 'E2E ps %' OR google_place_id LIKE 'e2e-ps-%'`,
    );
    const web = async (
      name: string,
      category: string,
      lng: number,
      lat: number,
      googlePlaceId: string | null = null,
    ): Promise<string> => {
      const [row] = (await db.query(
        `INSERT INTO places (source, name, category, location, location_source, location_expires_at, google_place_id)
         VALUES ('web', $1, $2::place_category, ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326),
                 $5, CASE WHEN $6::text IS NULL THEN NULL ELSE now() + interval '30 days' END, $6)
         RETURNING id`,
        [
          name,
          category,
          lng,
          lat,
          googlePlaceId ? 'google' : 'ai',
          googlePlaceId,
        ],
      )) as Array<{ id: string }>;
      return row.id;
    };
    const banhCan = await web(
      'E2E ps Bánh căn Nhà Chung',
      'food',
      108.4384,
      11.9421,
    );
    await db.query(`UPDATE places SET address = $2 WHERE id = $1`, [
      banhCan,
      '1 Nhà Chung, Phường 3',
    ]);
    webReu = await web(
      'E2E ps Cà phê Rêu',
      'cafe',
      108.44,
      11.945,
      'e2e-ps-web-reu',
    );
    await web('E2E ps Bánh căn Sài Gòn', 'food', 106.7, 10.78);
    const googleRow = async (
      googlePlaceId: string,
      name: string,
    ): Promise<string> => {
      const [row] = (await db.query(
        `INSERT INTO places (source, google_place_id, name, category, location, location_source, location_expires_at)
         VALUES ('google', $1, $2, 'food',
                 ST_SetSRID(ST_MakePoint(108.441, 11.946), 4326), 'google', now() + interval '20 days')
         ON CONFLICT (google_place_id) WHERE source IN ('google', 'web') DO UPDATE
           SET name = EXCLUDED.name, location = EXCLUDED.location,
               location_expires_at = EXCLUDED.location_expires_at
         RETURNING id`,
        [googlePlaceId, name],
      )) as Array<{ id: string }>;
      return row.id;
    };
    otherGoogleRow = await googleRow('e2e-ps-other', 'E2E ps tên người khác');
    await googleRow('e2e-ps-other-noname', 'E2E ps tên người khác 2');
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await db?.query(
      `DELETE FROM users
        WHERE display_name IN ('e2e-place-search', 'e2e-place-search-other', 'e2e-place-search-details')`,
    );
    await db?.query(
      `DELETE FROM places
        WHERE name LIKE 'E2E ps %' OR google_place_id LIKE 'e2e-ps-%'`,
    );
    await app?.close();
  });

  const api = (as = token) => {
    const server = app.getHttpServer();
    const auth = (req: request.Test) =>
      req.set('Authorization', `Bearer ${as}`);
    return {
      search: (regionId: string, q: string, online?: boolean) =>
        auth(
          request(server)
            .get(`/api/regions/${regionId}/places/search`)
            .query(online ? { q, online: 'true' } : { q }),
        ),
      preview: (id: string) =>
        auth(request(server).get(`/api/places/google/${id}`)),
      save: (body: Record<string, unknown>) =>
        auth(request(server).post('/api/places/google')).send(body),
      saveManual: (placeId: string, regionId: string) =>
        auth(request(server).put(`/api/saved-places/${placeId}`)).send({
          regionId,
        }),
    };
  };

  /** Chỉ đếm dòng của spec này: spec khác chạy song song cũng ghi `places`. */
  const countPlaces = async (): Promise<number> => {
    const [{ n }] = (await db.query(
      `SELECT count(*)::int AS n FROM places WHERE google_place_id LIKE 'e2e-ps-%'`,
    )) as Array<{ n: number }>;
    return n;
  };

  it('danh mục: không dấu vẫn khớp, chỉ dòng web trong vùng, không đọc tên dòng Google', async () => {
    const res = await api().search(daLat, 'banh can').expect(200);
    const names = res.body.catalog.map((h: { name: string }) => h.name);
    expect(names).toContain('E2E ps Bánh căn Nhà Chung');
    expect(names).not.toContain('E2E ps Bánh căn Sài Gòn');
    const other = await api().search(daLat, 'tên người khác').expect(200);
    expect(
      other.body.catalog.map((h: { name: string }) => h.name),
    ).not.toContain('E2E ps tên người khác');
    expect(res.body.google).toBeNull();
    expect(google.searchByName).not.toHaveBeenCalled();
    // Danh sách kết quả cũng có địa chỉ từ bài viết, không phải mở chi tiết mới thấy.
    expect(
      res.body.catalog.find(
        (h: { name: string }) => h.name === 'E2E ps Bánh căn Nhà Chung',
      ).address,
    ).toBe('1 Nhà Chung, Phường 3');
  });

  it('chuỗi tìm chỉ có khoảng trắng → 400, không tốn lượt Google', async () => {
    await api().search(daLat, '   ').expect(400);
    await api().search(daLat, '   ', true).expect(400);
    expect(google.searchByName).not.toHaveBeenCalled();
  });

  it('ký tự đặc biệt không lỗi và không khớp bừa', async () => {
    const res = await api().search(daLat, "%_'").expect(200);
    expect(res.body.catalog).toEqual([]);
  });

  it('online: trùng place_id đã có → existing (web: tên trong danh sách; Google: tên Google trực tiếp), còn lại giữ thứ tự Google', async () => {
    google.searchByName.mockResolvedValueOnce([
      {
        googlePlaceId: 'e2e-ps-new-2',
        name: 'Mới 2',
        address: 'A2',
        suggestedCategory: 'cafe',
      },
      {
        googlePlaceId: 'e2e-ps-web-reu',
        name: 'Rêu (Google)',
        address: null,
        suggestedCategory: 'cafe',
      },
      {
        googlePlaceId: 'e2e-ps-other',
        name: 'Tên Google thật',
        address: 'Địa chỉ Google',
        suggestedCategory: 'cafe',
      },
      // Dòng Google mà Google không trả tên: không lộ tên người khác, để ở danh sách Google.
      {
        googlePlaceId: 'e2e-ps-other-noname',
        name: null,
        address: null,
        suggestedCategory: 'cafe',
      },
      {
        googlePlaceId: 'e2e-ps-new-1',
        name: 'Mới 1',
        address: 'A1',
        suggestedCategory: 'cafe',
      },
    ]);
    const before = await countPlaces();
    const res = await api().search(daLat, 'quan', true).expect(200);
    expect(
      res.body.google.map((g: { googlePlaceId: string }) => g.googlePlaceId),
    ).toEqual(['e2e-ps-new-2', 'e2e-ps-other-noname', 'e2e-ps-new-1']);
    expect(
      res.body.existing.map(
        (h: { id: string; name: string; address: string | null }) => [
          h.id,
          h.name,
          h.address,
        ],
      ),
    ).toEqual([
      // Dòng web: địa chỉ từ bài viết (chưa có), không lấy địa chỉ Google.
      [webReu, 'E2E ps Cà phê Rêu', null],
      // Dòng Google: địa chỉ Google trực tiếp từ lượt tìm.
      [otherGoogleRow, 'Tên Google thật', 'Địa chỉ Google'],
    ]);
    expect(JSON.stringify(res.body)).not.toContain('E2E ps tên người khác');
    expect(await countPlaces()).toBe(before); // tìm không ghi DB
    expect(google.searchByName.mock.calls[0][1]).toHaveLength(4); // bbox của vùng
  });

  it('Google lỗi → vẫn có danh mục, google: null', async () => {
    google.searchByName.mockRejectedValueOnce(
      new GoogleUnavailableError('quota'),
    );
    const res = await api().search(daLat, 'banh can', true).expect(200);
    expect(res.body.google).toBeNull();
    expect(res.body.catalog.length).toBeGreaterThan(0);
  });

  it('quá giới hạn tìm online → 429; tìm danh mục vẫn được; Google lỗi không tính lượt', async () => {
    google.searchByName.mockRejectedValueOnce(
      new GoogleUnavailableError('quota'),
    );
    await api(otherToken).search(daLat, 'x', true).expect(200);
    google.searchByName.mockResolvedValue([]);
    for (let i = 0; i < 3; i++)
      await api(otherToken).search(daLat, 'x', true).expect(200);
    const res = await api(otherToken).search(daLat, 'x', true).expect(429);
    expect(res.body.code).toBe('PLACE_SEARCH_LIMIT');
    await api(otherToken).search(daLat, 'x').expect(200);
  });

  it('vùng không tồn tại → 404 REGION_NOT_FOUND', async () => {
    const res = await api().search(randomUUID(), 'x').expect(404);
    expect(res.body.code).toBe('REGION_NOT_FOUND');
  });

  it('xem trước: đã có trong DB → { placeId }; chưa có → nội dung trực tiếp; không ghi DB', async () => {
    const before = await countPlaces();
    const known = await api().preview('e2e-ps-web-reu').expect(200);
    expect(known.body).toEqual({ placeId: webReu });
    google.preview.mockResolvedValueOnce({
      content: {
        placeId: 'e2e-ps-new-1',
        name: 'Mới 1',
        googleMapsUri: null,
        address: 'A1',
        rating: 4.5,
        ratingCount: 10,
        openNow: null,
        weekdayHours: [],
        reviews: [],
        photos: [],
      },
      location: { lat: 11.95, lng: 108.44 },
      primaryType: 'coffee_shop',
    });
    const fresh = await api().preview('e2e-ps-new-1').expect(200);
    expect(fresh.body).toMatchObject({
      googlePlaceId: 'e2e-ps-new-1',
      name: 'Mới 1',
      suggestedCategory: 'cafe',
      coordinates: { lat: 11.95, lng: 108.44 },
    });
    expect(await countPlaces()).toBe(before);
  });

  it('quá giới hạn xem/lưu Google → 429 PLACE_DETAILS_LIMIT; địa điểm đã có không tính lượt', async () => {
    google.preview.mockResolvedValue(null);
    google.locate.mockResolvedValue({ lat: 11.95, lng: 108.44 });
    // Đã có trong DB: không gọi Google, không tốn lượt.
    for (let i = 0; i < 3; i++)
      await api(detailsToken).preview('e2e-ps-web-reu').expect(200);
    for (let i = 0; i < 5; i++)
      await api(detailsToken).preview(`e2e-ps-lim-${i}`).expect(404);
    const res = await api(detailsToken).preview('e2e-ps-lim-x').expect(429);
    expect(res.body.code).toBe('PLACE_DETAILS_LIMIT');
    const saved = await api(detailsToken)
      .save({
        googlePlaceId: 'e2e-ps-lim-save',
        name: 'x',
        category: 'food',
        regionId: daLat,
      })
      .expect(429);
    expect(saved.body.code).toBe('PLACE_DETAILS_LIMIT');
    expect(google.preview).toHaveBeenCalledTimes(5);
    expect(google.locate).not.toHaveBeenCalled();
    await api(detailsToken).preview('e2e-ps-web-reu').expect(200);
  });

  it('lưu vào vùng không tồn tại → 404 REGION_NOT_FOUND, không gọi Google', async () => {
    const res = await api()
      .save({
        googlePlaceId: 'e2e-ps-new-region',
        name: 'x',
        category: 'food',
        regionId: randomUUID(),
      })
      .expect(404);
    expect(res.body.code).toBe('REGION_NOT_FOUND');
    expect(google.locate).not.toHaveBeenCalled();
  });

  it('xem trước: id sai định dạng → 400; Google không còn → 404', async () => {
    expect((await api().preview('a%2Fb').expect(400)).body.code).toBe(
      'INVALID_GOOGLE_PLACE_ID',
    );
    google.preview.mockResolvedValueOnce(null);
    expect((await api().preview('e2e-ps-gone').expect(404)).body.code).toBe(
      'PLACE_NOT_FOUND',
    );
  });

  it('lưu: tạo một dòng Google với tên người dùng, lưu "Muốn đi" nguồn search; lưu lại idempotent', async () => {
    google.locate.mockResolvedValue({ lat: 11.95, lng: 108.44 });
    const body = {
      googlePlaceId: 'e2e-ps-new-1',
      name: '  Quán của tôi  ',
      category: 'cafe',
      regionId: daLat,
    };
    const first = await api().save(body).expect(201);
    const second = await api().save(body).expect(201);
    expect(second.body.placeId).toBe(first.body.placeId);
    const rows = await db.query(
      `SELECT name, source FROM places WHERE google_place_id = 'e2e-ps-new-1'`,
    );
    expect(rows).toEqual([{ name: 'Quán của tôi', source: 'google' }]);
    const [saved] = await db.query(
      `SELECT source, display_name FROM saved_places WHERE place_id = $1`,
      [first.body.placeId],
    );
    expect(saved).toEqual({ source: 'search', display_name: 'Quán của tôi' });

    // Thả tim thủ công lại không xóa nguồn search.
    await api().saveManual(first.body.placeId, daLat).expect(204);
    const [again] = await db.query(
      `SELECT source FROM saved_places WHERE place_id = $1`,
      [first.body.placeId],
    );
    expect(again).toEqual({ source: 'search' });
  });

  it('lưu một place_id đã ghép vào dòng web → lưu dòng web, không tạo dòng Google', async () => {
    const res = await api()
      .save({
        googlePlaceId: 'e2e-ps-web-reu',
        name: 'Rêu',
        category: 'cafe',
        regionId: daLat,
      })
      .expect(201);
    expect(res.body.placeId).toBe(webReu);
    const [{ n }] = await db.query(
      `SELECT count(*)::int AS n FROM places WHERE source = 'google' AND google_place_id = 'e2e-ps-web-reu'`,
    );
    expect(n).toBe(0);
  });

  it('lưu từ tìm kiếm một địa điểm đã lưu từ chia sẻ → giữ nguồn share', async () => {
    await db.query(
      `INSERT INTO saved_places (user_id, place_id, region_id, source)
       VALUES ($1, $2, $3, 'share')`,
      [otherUserId, webReu, daLat],
    );
    await api(otherToken)
      .save({
        googlePlaceId: 'e2e-ps-web-reu',
        name: 'Rêu',
        category: 'cafe',
        regionId: daLat,
      })
      .expect(201);
    const [saved] = await db.query(
      `SELECT source FROM saved_places WHERE user_id = $1 AND place_id = $2`,
      [otherUserId, webReu],
    );
    expect(saved).toEqual({ source: 'share' });
  });

  it('lưu: Google không trả tọa độ → 404; tên rỗng → 400', async () => {
    google.locate.mockResolvedValueOnce(null);
    expect(
      (
        await api()
          .save({
            googlePlaceId: 'e2e-ps-gone2',
            name: 'x',
            category: 'food',
            regionId: daLat,
          })
          .expect(404)
      ).body.code,
    ).toBe('PLACE_NOT_FOUND');
    await api()
      .save({
        googlePlaceId: 'e2e-ps-new-9',
        name: '   ',
        category: 'food',
        regionId: daLat,
      })
      .expect(400);
  });

  it('lưu với addToSaved=false: có id nhưng không vào "Muốn đi"', async () => {
    google.locate.mockResolvedValueOnce({ lat: 11.94, lng: 108.44 });
    const res = await api()
      .save({
        googlePlaceId: 'e2e-ps-nosave',
        name: 'E2E ps Không lưu',
        category: 'cafe',
        regionId: daLat,
        addToSaved: false,
      })
      .expect(201);
    expect(res.body.placeId).toEqual(expect.any(String));
    const saved = (await db.query(
      `SELECT 1 FROM saved_places WHERE place_id = $1`,
      [res.body.placeId],
    )) as unknown[];
    expect(saved).toHaveLength(0);
  });
});
