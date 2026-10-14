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
import { GooglePlacesService } from '../src/modules/google/google-places.service.js';
import { RegionAreaService } from '../src/modules/regions/region-area.service.js';
import {
  LinkMetadataService,
  UnsafeUrlError,
} from '../src/modules/share-import/link-metadata.service.js';
import { PLACE_EXTRACTOR } from '../src/modules/share-import/place-extraction.js';
import { RegionLookupService } from '../src/modules/share-import/region-lookup.service.js';
import { ShareImportsService } from '../src/modules/share-import/share-imports.service.js';

/** Chia sẻ vào app (F4): metadata, Gemini và Google giả; database thật. */
describe('Chia sẻ vào app (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let token: string;
  let otherToken: string;
  let daLat: string;
  let webPlace: string;
  const metadata = { assertSafe: vi.fn(async () => undefined), fetch: vi.fn() };
  const extract = vi.fn();
  const google = {
    enabled: true,
    searchText: vi.fn(),
    summary: vi.fn(async (id: string) => ({
      name: `Google ${id}`,
      address: `Địa chỉ ${id}`,
    })),
    locate: vi.fn(),
    details: vi.fn(async () => null),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LinkMetadataService)
      .useValue(metadata)
      .overrideProvider(PLACE_EXTRACTOR)
      .useValue(extract)
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
    const jwt = app.get(JwtService);
    const [user, other] = (await db.query(
      `INSERT INTO users (display_name) VALUES ('e2e-share'), ('e2e-share-other') RETURNING id`,
    )) as Array<{ id: string }>;
    token = jwt.sign({ sub: user.id });
    otherToken = jwt.sign({ sub: other.id });

    const [region] = (await db.query(
      `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
    )) as Array<{ id: string }>;
    daLat = region.id;
    await app.get(RegionAreaService).ensure(daLat);

    await db.query(`DELETE FROM places WHERE name LIKE 'E2E share %'`);
    const [place] = (await db.query(
      `INSERT INTO places (source, name, category, location, location_source, composite_score)
       VALUES ('web', 'E2E share Bánh căn Nhà Chung', 'food',
               ST_SetSRID(ST_MakePoint(108.4384, 11.9421), 4326), 'ai', 0)
       RETURNING id`,
    )) as Array<{ id: string }>;
    webPlace = place.id;
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM users WHERE display_name LIKE 'e2e-share%'`);
    await db?.query(
      `DELETE FROM places
        WHERE name LIKE 'E2E share %' OR google_place_id LIKE 'e2e-share-%'`,
    );
    await app?.close();
  });

  // Giá trị "Once" mà test trước không dùng tới (job chỉ có văn bản không gọi fetch) không được rò sang test sau.
  beforeEach(() => {
    metadata.fetch.mockReset();
    extract.mockReset();
    google.searchText.mockReset();
  });

  const api = (as = token) => {
    const server = app.getHttpServer();
    const auth = (req: request.Test) =>
      req.set('Authorization', `Bearer ${as}`);
    return {
      create: (body: object) =>
        auth(request(server).post('/api/share-imports')).send(body),
      list: () => auth(request(server).get('/api/share-imports')),
      get: (id: string) =>
        auth(request(server).get(`/api/share-imports/${id}`)),
      save: (id: string, selections: object[]) =>
        auth(request(server).post(`/api/share-imports/${id}/save`)).send({
          selections,
        }),
    };
  };

  async function waitDone(id: string, as = token) {
    for (let i = 0; i < 50; i++) {
      const res = await api(as).get(id).expect(200);
      if (res.body.status !== 'pending') return res.body;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('job không xong');
  }

  describe('RegionLookupService', () => {
    it('tìm Đà Lạt theo tên không dấu và gán tọa độ trong Đà Lạt vào Đà Lạt (bbox nhỏ hơn Lâm Đồng)', async () => {
      const regions = app.get(RegionLookupService);
      const hit = await regions.findByHint('da lat');
      expect(hit?.id).toBe(daLat);
      const [assigned, nowhere] = await regions.assign([
        { lat: 11.9404, lng: 108.4583 },
        { lat: 0, lng: 0 },
      ]);
      expect(assigned).toBe(daLat);
      expect(nowhere).toBeNull();
    });
  });

  it('caption + link TikTok: nhận diện, khớp danh mục và Google, lưu vào Muốn đi', async () => {
    metadata.fetch.mockResolvedValueOnce({
      platform: 'tiktok',
      finalUrl: 'https://www.tiktok.com/@an/video/1',
      title: 'Bánh căn Nhà Chung và Cà phê E2E Gió Núi ở Đà Lạt',
      description: null,
      authorName: 'an.reviews',
      thumbnailUrl: 'https://cdn/t.jpg',
    });
    extract.mockResolvedValueOnce({
      places: [
        {
          name: 'E2E share Bánh căn Nhà Chung',
          category: 'food',
          regionHint: 'Đà Lạt',
          address: '',
          quote: 'Bánh căn',
        },
        {
          name: 'Cà phê E2E Gió Núi',
          category: 'cafe',
          regionHint: 'Đà Lạt',
          address: '',
          quote: 'Gió Núi',
        },
      ],
    });
    google.searchText.mockResolvedValueOnce([
      { placeId: 'e2e-share-gionui', lat: 11.9555, lng: 108.4422 },
    ]);

    const created = await api()
      .create({
        text: 'E2E share Bánh căn Nhà Chung ngon 😋 https://vt.tiktok.com/ZS1/?_r=1',
      })
      .expect(202);
    const job = await waitDone(created.body.id);

    expect(metadata.fetch.mock.calls[0][0].toString()).toBe(
      'https://vt.tiktok.com/ZS1/',
    );
    expect(job).toMatchObject({
      status: 'done',
      errorCode: null,
      source: {
        platform: 'tiktok',
        title: expect.stringContaining('Bánh căn'),
        authorName: 'an.reviews',
      },
      candidateCount: 2,
      savedCount: 0,
    });
    const [bc, gionui] = job.candidates;
    expect(bc).toMatchObject({
      confidence: 'high',
      options: [
        { ref: { kind: 'catalog', placeId: webPlace }, regionId: daLat },
      ],
    });
    // Lựa chọn tin cậy cao không cần tên Google (spec §4.6).
    expect(gionui).toMatchObject({
      confidence: 'high',
      options: [
        {
          ref: { kind: 'google', googlePlaceId: 'e2e-share-gionui' },
          name: null,
          regionId: daLat,
        },
      ],
    });

    const saved = await api()
      .save(created.body.id, [
        { candidateKey: bc.key, kind: 'catalog', placeId: webPlace },
        {
          candidateKey: gionui.key,
          kind: 'google',
          googlePlaceId: 'e2e-share-gionui',
        },
      ])
      .expect(200);
    expect(saved.body).toEqual({ saved: 2 });

    // Hạn tọa độ tính từ lúc job lấy tọa độ (created_at), không phải lúc lưu.
    const [expiry] = (await db.query(
      `SELECT abs(extract(epoch FROM p.location_expires_at - (si.created_at + interval '30 days'))) < 60 AS ok
         FROM places p, share_imports si
        WHERE p.google_place_id = 'e2e-share-gionui' AND si.id = $1`,
      [created.body.id],
    )) as Array<{ ok: boolean }>;
    expect(expiry.ok).toBe(true);

    // Dòng đã có tọa độ mới hơn (ví dụ từ một lượt chia sẻ sau): lưu lại không ghi đè bằng tọa độ cũ.
    await db.query(
      `UPDATE places SET location_expires_at = now() + interval '40 days',
              location = ST_SetSRID(ST_MakePoint(108.5, 11.96), 4326)
        WHERE google_place_id = 'e2e-share-gionui'`,
    );

    // Lưu lại cùng lựa chọn: idempotent, không tạo dòng Google thứ hai.
    await api()
      .save(created.body.id, [
        {
          candidateKey: gionui.key,
          kind: 'google',
          googlePlaceId: 'e2e-share-gionui',
        },
      ])
      .expect(200);
    const [{ n }] = (await db.query(
      `SELECT count(*)::int AS n FROM places WHERE google_place_id = 'e2e-share-gionui'`,
    )) as Array<{ n: number }>;
    expect(n).toBe(1);
    const [row] = (await db.query(
      `SELECT name, source, location_expires_at > now() + interval '39 days' AS kept, ST_X(location) AS lng
         FROM places WHERE google_place_id = 'e2e-share-gionui'`,
    )) as Array<{ name: string; source: string; kept: boolean; lng: number }>;
    // Tên từ nội dung người dùng, không phải tên Google; tọa độ mới hơn được giữ.
    expect(row).toEqual({
      name: 'Cà phê E2E Gió Núi',
      source: 'google',
      kept: true,
      lng: 108.5,
    });

    const list = await request(app.getHttpServer())
      .get('/api/saved-places')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const fromShare = list.body.filter(
      (s: { source: string }) => s.source === 'share',
    );
    expect(fromShare).toHaveLength(2);
    expect(fromShare[0].shareSource).toMatchObject({ platform: 'tiktok' });

    const summary = await api().list().expect(200);
    expect(summary.body[0]).toMatchObject({
      id: created.body.id,
      savedCount: 2,
    });
  });

  it('hai người chia sẻ cùng một địa điểm Google với tên khác nhau: mỗi người thấy tên của mình', async () => {
    const shareAs = async (as: string, name: string) => {
      metadata.fetch.mockReset();
      extract.mockResolvedValueOnce({
        places: [
          {
            name,
            category: 'cafe',
            regionHint: 'Đà Lạt',
            address: '',
            quote: name,
          },
        ],
      });
      google.searchText.mockResolvedValueOnce([
        { placeId: 'e2e-share-name', lat: 11.95, lng: 108.44 },
      ]);
      const created = await api(as)
        .create({ text: `Đi ${name} ở Đà Lạt nè` })
        .expect(202);
      const job = await waitDone(created.body.id, as);
      expect(job.status).toBe('done');
      const [candidate] = job.candidates;
      await api(as)
        .save(created.body.id, [
          {
            candidateKey: candidate.key,
            kind: 'google',
            googlePlaceId: 'e2e-share-name',
          },
        ])
        .expect(200);
    };
    const savedName = async (as: string) => {
      const list = await request(app.getHttpServer())
        .get('/api/saved-places')
        .set('Authorization', `Bearer ${as}`)
        .expect(200);
      const [{ id }] = (await db.query(
        `SELECT id FROM places WHERE google_place_id = 'e2e-share-name'`,
      )) as Array<{ id: string }>;
      return list.body.find((s: { placeId: string }) => s.placeId === id)
        ?.name as string | undefined;
    };

    await shareAs(token, 'Cà phê E2E Sương Sớm');
    await shareAs(otherToken, 'Quán E2E Sương');
    expect(await savedName(token)).toBe('Cà phê E2E Sương Sớm');
    expect(await savedName(otherToken)).toBe('Quán E2E Sương');

    // Thả tim thủ công lại không xóa tên của lượt chia sẻ.
    const [{ id: placeId }] = (await db.query(
      `SELECT id FROM places WHERE google_place_id = 'e2e-share-name'`,
    )) as Array<{ id: string }>;
    await request(app.getHttpServer())
      .put(`/api/saved-places/${placeId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ regionId: daLat })
      .expect(204);
    expect(await savedName(otherToken)).toBe('Quán E2E Sương');

    // Chi tiết: có nội dung Google thì dùng tên Google trực tiếp (không lưu); không thì tên trong places.
    google.details.mockResolvedValueOnce({
      placeId: 'e2e-share-name',
      name: 'Google Sương Sớm Coffee',
      googleMapsUri: null,
      address: null,
      rating: null,
      ratingCount: null,
      openNow: null,
      weekdayHours: [],
      reviews: [],
      photos: [],
    } as never);
    const live = await request(app.getHttpServer())
      .get(`/api/places/${placeId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(live.body.name).toBe('Google Sương Sớm Coffee');
    const [{ name: stored }] = (await db.query(
      `SELECT name FROM places WHERE id = $1`,
      [placeId],
    )) as Array<{ name: string }>;
    expect(stored).not.toBe('Google Sương Sớm Coffee');
    const fallback = await request(app.getHttpServer())
      .get(`/api/places/${placeId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(fallback.body.name).toBe(stored);
  });

  it('ứng viên tin cậy thấp có tối đa 3 lựa chọn kèm tên Google lấy trực tiếp', async () => {
    metadata.fetch.mockResolvedValueOnce(null);
    extract.mockResolvedValueOnce({
      places: [
        {
          name: 'Quán Gió Mới',
          category: 'food',
          regionHint: '',
          address: '',
          quote: '',
        },
      ],
    });
    google.searchText.mockResolvedValueOnce([
      { placeId: 'e2e-share-a', lat: 11.95, lng: 108.44 },
      { placeId: 'e2e-share-b', lat: 11.93, lng: 108.45 },
    ]);
    const created = await api()
      .create({ text: 'Quán Gió Mới ngon' })
      .expect(202);
    const job = await waitDone(created.body.id);
    expect(job.candidates[0].confidence).toBe('low');
    expect(
      job.candidates[0].options.map((o: { name: string }) => o.name),
    ).toEqual(['Google e2e-share-a', 'Google e2e-share-b']);
    const [stored] = (await db.query(
      `SELECT candidates FROM share_imports WHERE id = $1`,
      [created.body.id],
    )) as Array<{
      candidates: unknown;
    }>;
    // Tên Google không được lưu.
    expect(JSON.stringify(stored.candidates)).not.toContain(
      'Google e2e-share-a',
    );
  });

  it('lựa chọn không có trong ứng viên → 400 INVALID_SELECTION', async () => {
    metadata.fetch.mockResolvedValueOnce(null);
    extract.mockResolvedValueOnce({
      places: [
        {
          name: 'E2E share Bánh căn Nhà Chung',
          category: 'food',
          regionHint: 'Đà Lạt',
          address: '',
          quote: '',
        },
      ],
    });
    const created = await api()
      .create({ text: 'E2E share Bánh căn Nhà Chung' })
      .expect(202);
    await waitDone(created.body.id);
    const res = await api()
      .save(created.body.id, [
        { candidateKey: 'c1', kind: 'google', googlePlaceId: 'e2e-share-bịa' },
      ])
      .expect(400);
    expect(res.body.code).toBe('INVALID_SELECTION');
  });

  it('job của người khác → 404; job chưa xong → 409', async () => {
    metadata.fetch.mockImplementationOnce(() => new Promise(() => undefined)); // treo
    const created = await api()
      .create({ url: 'https://example.vn/x', text: 'chờ mãi' })
      .expect(202);
    const notReady = await api()
      .save(created.body.id, [
        { candidateKey: 'c1', kind: 'catalog', placeId: webPlace },
      ])
      .expect(409);
    expect(notReady.body.code).toBe('SHARE_IMPORT_NOT_READY');
    const res = await api(otherToken).get(created.body.id).expect(404);
    expect(res.body.code).toBe('SHARE_IMPORT_NOT_FOUND');

    // Server tắt giữa chừng: job đang chạy bị đánh INTERRUPTED, client thôi chờ.
    await app.get(ShareImportsService).onModuleDestroy();
    expect((await api().get(created.body.id).expect(200)).body).toMatchObject({
      status: 'failed',
      errorCode: 'INTERRUPTED',
    });
  });

  it('lựa chọn Google của job quá 30 ngày → 400 SHARE_IMPORT_EXPIRED (kể cả khi ứng viên đã bị dọn)', async () => {
    const [{ id: userId }] = (await db.query(
      `SELECT id FROM users WHERE display_name = 'e2e-share'`,
    )) as Array<{
      id: string;
    }>;
    const [{ id }] = (await db.query(
      `INSERT INTO share_imports (user_id, shared_text, status, created_at)
       VALUES ($1, 'cũ lắm', 'done', now() - interval '31 days') RETURNING id`,
      [userId],
    )) as Array<{ id: string }>;
    const res = await api()
      .save(id, [
        { candidateKey: 'c1', kind: 'google', googlePlaceId: 'e2e-share-cu' },
      ])
      .expect(400);
    expect(res.body.code).toBe('SHARE_IMPORT_EXPIRED');
  });

  it('không có metadata lẫn văn bản → failed METADATA_UNAVAILABLE; Gemini lỗi → AI_UNAVAILABLE', async () => {
    metadata.fetch.mockResolvedValueOnce(null);
    const a = await api()
      .create({ url: 'https://www.facebook.com/share/r/1' })
      .expect(202);
    expect(await waitDone(a.body.id)).toMatchObject({
      status: 'failed',
      errorCode: 'METADATA_UNAVAILABLE',
    });

    metadata.fetch.mockResolvedValueOnce(null);
    extract.mockRejectedValueOnce(new Error('429'));
    const b = await api().create({ text: 'Quán gì đó' }).expect(202);
    expect(await waitDone(b.body.id)).toMatchObject({
      status: 'failed',
      errorCode: 'AI_UNAVAILABLE',
    });
  });

  it('URL không hợp lệ hoặc trỏ vào IP nội bộ → 400 INVALID_SHARE_URL', async () => {
    await api().create({ url: 'javascript:alert(1)' }).expect(400);
    metadata.assertSafe.mockRejectedValueOnce(new UnsafeUrlError('nội bộ'));
    const res = await api()
      .create({ url: 'http://metadata.internal/' })
      .expect(400);
    expect(res.body.code).toBe('INVALID_SHARE_URL');
  });

  it('quá giới hạn 24 giờ → 429 SHARE_IMPORT_LIMIT', async () => {
    const [{ id: userId }] = (await db.query(
      `SELECT id FROM users WHERE display_name = 'e2e-share-other'`,
    )) as Array<{ id: string }>;
    await db.query(
      `INSERT INTO share_imports (user_id, shared_text, status)
       SELECT $1, 'x', 'done' FROM generate_series(1, 30)`,
      [userId],
    );
    const res = await api(otherToken)
      .create({ text: 'thêm một lượt' })
      .expect(429);
    expect(res.body.code).toBe('SHARE_IMPORT_LIMIT');
  });

  it('job pending cũ bị đánh INTERRUPTED khi khởi động', async () => {
    const [{ id: userId }] = (await db.query(
      `SELECT id FROM users WHERE display_name = 'e2e-share'`,
    )) as Array<{ id: string }>;
    const [{ id }] = (await db.query(
      `INSERT INTO share_imports (user_id, shared_text, status, created_at)
       VALUES ($1, 'cũ', 'pending', now() - interval '10 minutes') RETURNING id`,
      [userId],
    )) as Array<{ id: string }>;
    await app.get(ShareImportsService).recoverInterrupted();
    const job = (await api().get(id).expect(200)).body;
    expect(job).toMatchObject({ status: 'failed', errorCode: 'INTERRUPTED' });
  });
});
