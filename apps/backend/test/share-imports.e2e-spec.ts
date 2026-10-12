import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { GooglePlacesService } from '../src/modules/google/google-places.service.js';
import { RegionAreaService } from '../src/modules/regions/region-area.service.js';
import { LinkMetadataService, UnsafeUrlError } from '../src/modules/share-import/link-metadata.service.js';
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
  let osmPlace: string;
  const metadata = { assertSafe: vi.fn(async () => undefined), fetch: vi.fn() };
  const extract = vi.fn();
  const google = {
    enabled: true,
    searchText: vi.fn(),
    summary: vi.fn(async (id: string) => ({ name: `Google ${id}`, address: `Địa chỉ ${id}` })),
    locate: vi.fn(),
    details: vi.fn(async () => null),
    matchPlaceId: vi.fn(async () => null),
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

    const [place] = (await db.query(
      `INSERT INTO places (osm_type, osm_id, name, category, location, composite_score)
       VALUES ('node', -9400, 'E2E share Bánh căn Nhà Chung', 'food',
               ST_SetSRID(ST_MakePoint(108.4384, 11.9421), 4326), 50)
       ON CONFLICT (osm_type, osm_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    )) as Array<{ id: string }>;
    osmPlace = place.id;
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM users WHERE display_name LIKE 'e2e-share%'`);
    await db?.query(
      `DELETE FROM places
        WHERE (osm_id <= -9400 AND osm_id > -9500) OR google_place_id LIKE 'e2e-share-%'`,
    );
    await app?.close();
  });

  const api = (as = token) => {
    const server = app.getHttpServer();
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${as}`);
    return {
      create: (body: object) => auth(request(server).post('/api/share-imports')).send(body),
      list: () => auth(request(server).get('/api/share-imports')),
      get: (id: string) => auth(request(server).get(`/api/share-imports/${id}`)),
      save: (id: string, selections: object[]) =>
        auth(request(server).post(`/api/share-imports/${id}/save`)).send({ selections }),
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
        { name: 'E2E share Bánh căn Nhà Chung', category: 'food', regionHint: 'Đà Lạt', address: '', quote: 'Bánh căn' },
        { name: 'Cà phê E2E Gió Núi', category: 'cafe', regionHint: 'Đà Lạt', address: '', quote: 'Gió Núi' },
      ],
    });
    google.searchText.mockResolvedValueOnce([{ placeId: 'e2e-share-gionui', lat: 11.9555, lng: 108.4422 }]);

    const created = await api()
      .create({ text: 'E2E share Bánh căn Nhà Chung ngon 😋 https://vt.tiktok.com/ZS1/?_r=1' })
      .expect(202);
    const job = await waitDone(created.body.id);

    expect(metadata.fetch.mock.calls[0][0].toString()).toBe('https://vt.tiktok.com/ZS1/');
    expect(job).toMatchObject({
      status: 'done',
      errorCode: null,
      source: { platform: 'tiktok', title: expect.stringContaining('Bánh căn'), authorName: 'an.reviews' },
      candidateCount: 2,
      savedCount: 0,
    });
    const [bc, gionui] = job.candidates;
    expect(bc).toMatchObject({ confidence: 'high', options: [{ ref: { kind: 'catalog', placeId: osmPlace }, regionId: daLat }] });
    // Lựa chọn tin cậy cao không cần tên Google (spec §4.6).
    expect(gionui).toMatchObject({
      confidence: 'high',
      options: [{ ref: { kind: 'google', googlePlaceId: 'e2e-share-gionui' }, name: null, regionId: daLat }],
    });

    const saved = await api()
      .save(created.body.id, [
        { candidateKey: bc.key, kind: 'catalog', placeId: osmPlace },
        { candidateKey: gionui.key, kind: 'google', googlePlaceId: 'e2e-share-gionui' },
      ])
      .expect(200);
    expect(saved.body).toEqual({ saved: 2 });

    // Lưu lại cùng lựa chọn: idempotent, không tạo dòng Google thứ hai.
    await api()
      .save(created.body.id, [{ candidateKey: gionui.key, kind: 'google', googlePlaceId: 'e2e-share-gionui' }])
      .expect(200);
    const [{ n }] = (await db.query(
      `SELECT count(*)::int AS n FROM places WHERE google_place_id = 'e2e-share-gionui'`,
    )) as Array<{ n: number }>;
    expect(n).toBe(1);
    const [row] = (await db.query(
      `SELECT name, source, location_expires_at > now() + interval '29 days' AS fresh
         FROM places WHERE google_place_id = 'e2e-share-gionui'`,
    )) as Array<{ name: string; source: string; fresh: boolean }>;
    // Tên từ nội dung người dùng, không phải tên Google.
    expect(row).toEqual({ name: 'Cà phê E2E Gió Núi', source: 'google', fresh: true });

    const list = await request(app.getHttpServer())
      .get('/api/saved-places')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const fromShare = list.body.filter((s: { source: string }) => s.source === 'share');
    expect(fromShare).toHaveLength(2);
    expect(fromShare[0].shareSource).toMatchObject({ platform: 'tiktok' });

    const summary = await api().list().expect(200);
    expect(summary.body[0]).toMatchObject({ id: created.body.id, savedCount: 2 });
  });

  it('ứng viên tin cậy thấp có tối đa 3 lựa chọn kèm tên Google lấy trực tiếp', async () => {
    metadata.fetch.mockResolvedValueOnce(null);
    extract.mockResolvedValueOnce({
      places: [{ name: 'Quán Gió Mới', category: 'food', regionHint: '', address: '', quote: '' }],
    });
    google.searchText.mockResolvedValueOnce([
      { placeId: 'e2e-share-a', lat: 11.95, lng: 108.44 },
      { placeId: 'e2e-share-b', lat: 11.93, lng: 108.45 },
    ]);
    const created = await api().create({ text: 'Quán Gió Mới ngon' }).expect(202);
    const job = await waitDone(created.body.id);
    expect(job.candidates[0].confidence).toBe('low');
    expect(job.candidates[0].options.map((o: { name: string }) => o.name)).toEqual([
      'Google e2e-share-a',
      'Google e2e-share-b',
    ]);
    const [stored] = (await db.query(`SELECT candidates FROM share_imports WHERE id = $1`, [created.body.id])) as Array<{
      candidates: unknown;
    }>;
    // Tên Google không được lưu.
    expect(JSON.stringify(stored.candidates)).not.toContain('Google e2e-share-a');
  });

  it('lựa chọn không có trong ứng viên → 400 INVALID_SELECTION', async () => {
    metadata.fetch.mockResolvedValueOnce(null);
    extract.mockResolvedValueOnce({
      places: [{ name: 'E2E share Bánh căn Nhà Chung', category: 'food', regionHint: 'Đà Lạt', address: '', quote: '' }],
    });
    const created = await api().create({ text: 'E2E share Bánh căn Nhà Chung' }).expect(202);
    await waitDone(created.body.id);
    const res = await api()
      .save(created.body.id, [{ candidateKey: 'c1', kind: 'google', googlePlaceId: 'e2e-share-bịa' }])
      .expect(400);
    expect(res.body.code).toBe('INVALID_SELECTION');
  });

  it('job của người khác → 404; job chưa xong → 409', async () => {
    metadata.fetch.mockImplementationOnce(() => new Promise(() => undefined)); // treo
    const created = await api().create({ url: 'https://example.vn/x', text: 'chờ mãi' }).expect(202);
    const notReady = await api()
      .save(created.body.id, [{ candidateKey: 'c1', kind: 'catalog', placeId: osmPlace }])
      .expect(409);
    expect(notReady.body.code).toBe('SHARE_IMPORT_NOT_READY');
    const res = await api(otherToken).get(created.body.id).expect(404);
    expect(res.body.code).toBe('SHARE_IMPORT_NOT_FOUND');
  });

  it('không có metadata lẫn văn bản → failed METADATA_UNAVAILABLE; Gemini lỗi → AI_UNAVAILABLE', async () => {
    metadata.fetch.mockResolvedValueOnce(null);
    const a = await api().create({ url: 'https://www.facebook.com/share/r/1' }).expect(202);
    expect(await waitDone(a.body.id)).toMatchObject({ status: 'failed', errorCode: 'METADATA_UNAVAILABLE' });

    metadata.fetch.mockResolvedValueOnce(null);
    extract.mockRejectedValueOnce(new Error('429'));
    const b = await api().create({ text: 'Quán gì đó' }).expect(202);
    expect(await waitDone(b.body.id)).toMatchObject({ status: 'failed', errorCode: 'AI_UNAVAILABLE' });
  });

  it('URL không hợp lệ hoặc trỏ vào IP nội bộ → 400 INVALID_SHARE_URL', async () => {
    await api().create({ url: 'javascript:alert(1)' }).expect(400);
    metadata.assertSafe.mockRejectedValueOnce(new UnsafeUrlError('nội bộ'));
    const res = await api().create({ url: 'http://metadata.internal/' }).expect(400);
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
    const res = await api(otherToken).create({ text: 'thêm một lượt' }).expect(429);
    expect(res.body.code).toBe('SHARE_IMPORT_LIMIT');
  });

  it('job pending cũ bị đánh INTERRUPTED khi khởi động', async () => {
    const [{ id: userId }] = (await db.query(`SELECT id FROM users WHERE display_name = 'e2e-share'`)) as Array<{ id: string }>;
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
