import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { OpenDataService } from '../src/modules/open-data/open-data.service.js';
import { matchCatalog } from '../src/modules/places/catalog-match.js';

/** Địa điểm tự ghim và ghi chú riêng (spec 2026-10-21-user-pinned-places), trên database thật. */
describe('Địa điểm tự ghim và ghi chú (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let userId: string;
  let otherId: string;
  let token: string;
  let otherToken: string;
  let daLat: string;
  let webPlaceId: string;
  let shareImportId: string;
  let pinnedId: string;
  let groupId: string | undefined;
  const openData = {
    searchPlaces: vi.fn(async () => []),
    reverse: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OpenDataService)
      .useValue(openData)
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
      `INSERT INTO users (display_name) VALUES ('e2e-user-places'), ('e2e-user-places-other') RETURNING id`,
    )) as Array<{ id: string }>;
    userId = user.id;
    otherId = other.id;
    token = jwt.sign({ sub: userId });
    otherToken = jwt.sign({ sub: otherId });
    const [region] = (await db.query(
      `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
    )) as Array<{ id: string }>;
    daLat = region.id;
    const [web] = (await db.query(
      `INSERT INTO places (source, name, category, location, location_source)
       VALUES ('web', 'E2E up Quán web', 'food', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 'ai')
       RETURNING id`,
    )) as Array<{ id: string }>;
    webPlaceId = web.id;
    const [share] = (await db.query(
      `INSERT INTO share_imports (user_id, status, platform, shared_text) VALUES ($1, 'done', 'web', 'e2e') RETURNING id`,
      [userId],
    )) as Array<{ id: string }>;
    shareImportId = share.id;
    await api()
      .put(`/api/saved-places/${webPlaceId}`)
      .send({ regionId: daLat })
      .expect(204);
  });

  afterAll(async () => {
    if (groupId) await db?.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
    await db?.query(
      `DELETE FROM itineraries WHERE owner_id IN (SELECT id FROM users WHERE display_name = 'e2e-user-places')`,
    );
    await db?.query(
      `DELETE FROM users WHERE display_name IN ('e2e-user-places', 'e2e-user-places-other')`,
    );
    await db?.query(`DELETE FROM places WHERE name LIKE 'E2E up %'`);
    await app?.close();
  });

  /** Request kèm JWT của người dùng chính (hoặc `as`). */
  const api = (as?: string) => {
    const server = app.getHttpServer();
    const auth = (req: request.Test) =>
      req.set('Authorization', `Bearer ${as ?? token}`);
    return {
      get: (url: string) => auth(request(server).get(url)),
      post: (url: string) => auth(request(server).post(url)),
      patch: (url: string) => auth(request(server).patch(url)),
      put: (url: string) => auth(request(server).put(url)),
    };
  };

  it('DB: dòng user cần created_by và tọa độ; place_notes chặn giá ngược', async () => {
    await expect(
      db.query(
        `INSERT INTO places (source, name, category, location, location_source)
         VALUES ('user', 'E2E up thiếu người tạo', 'food', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 'user')`,
      ),
    ).rejects.toThrow(/chk_place_source/);
    const [row] = (await db.query(
      `INSERT INTO places (source, name, category, location, location_source, created_by)
       VALUES ('user', 'E2E up hợp lệ', 'food', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 'user', $1)
       RETURNING id`,
      [userId],
    )) as Array<{ id: string }>;
    await expect(
      db.query(
        `INSERT INTO place_notes (user_id, place_id, price_min, price_max) VALUES ($1, $2, 200, 100)`,
        [userId, row.id],
      ),
    ).rejects.toThrow(/chk_place_notes_price/);
  });

  it('PATCH /places/:id/notes: sửa từng trường, null thì xóa, rỗng hết thì xóa dòng; GET thấy ghi chú của chính mình', async () => {
    await api()
      .patch(`/api/places/${webPlaceId}/notes`)
      .send({ note: 'Bún ngon', priceMin: 30000, priceMax: 50000 })
      .expect(200)
      .expect((r) =>
        expect(r.body).toEqual({
          note: 'Bún ngon',
          openingHours: null,
          priceMin: 30000,
          priceMax: 50000,
        }),
      );
    await api()
      .patch(`/api/places/${webPlaceId}/notes`)
      .send({ openingHours: 'Mo-Su 06:00-10:00' })
      .expect(200);

    const saved = await api().get('/api/saved-places').expect(200);
    expect(
      saved.body.find((s: { placeId: string }) => s.placeId === webPlaceId)
        .notes,
    ).toMatchObject({ note: 'Bún ngon', openingHours: 'Mo-Su 06:00-10:00' });
    const detail = await api().get(`/api/places/${webPlaceId}`).expect(200);
    expect(detail.body.notes.note).toBe('Bún ngon');
    expect(detail.body.createdByMe).toBe(false);
    // Người khác không thấy ghi chú của mình.
    const other = await api(otherToken)
      .get(`/api/places/${webPlaceId}`)
      .expect(200);
    expect(other.body.notes).toBeNull();

    await api()
      .patch(`/api/places/${webPlaceId}/notes`)
      .send({ note: null, openingHours: null, priceMin: null, priceMax: null })
      .expect(200)
      .expect((r) => expect(r.body).toEqual({}));
    const [{ n }] = (await db.query(
      `SELECT count(*)::int AS n FROM place_notes WHERE place_id = $1`,
      [webPlaceId],
    )) as Array<{ n: number }>;
    expect(n).toBe(0);
  });

  it('PATCH notes: giờ sai 400 INVALID_OPENING_HOURS, giá ngược 400 INVALID_PRICE, địa điểm không có 404', async () => {
    await api()
      .patch(`/api/places/${webPlaceId}/notes`)
      .send({ openingHours: 'cả ngày' })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('INVALID_OPENING_HOURS'));
    await api()
      .patch(`/api/places/${webPlaceId}/notes`)
      .send({ priceMin: 9, priceMax: 1 })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('INVALID_PRICE'));
    await api()
      .patch('/api/places/00000000-0000-4000-8000-000000000000/notes')
      .send({ note: 'x' })
      .expect(404);
  });
  it('POST /places/user: tạo điểm, lưu vào Muốn đi kèm ghi chú; từ share thì tính vào lượt chia sẻ', async () => {
    const res = await api()
      .post('/api/places/user')
      .send({
        name: '  E2E up Quán chè bà Tư ',
        category: 'food',
        lat: 11.94,
        lng: 108.44,
        regionId: daLat,
        address: '12 Trần Hưng Đạo',
        notes: { priceMin: 20000, priceMax: 40000 },
        shareImportId,
      })
      .expect(201);
    pinnedId = res.body.placeId;
    const saved = (await api().get('/api/saved-places').expect(200)).body.find(
      (s: { placeId: string }) => s.placeId === pinnedId,
    );
    expect(saved).toMatchObject({
      name: 'E2E up Quán chè bà Tư',
      source: 'share',
      locationSource: 'user',
      notes: { priceMin: 20000, priceMax: 40000 },
    });
    const job = await api()
      .get(`/api/share-imports/${shareImportId}`)
      .expect(200);
    expect(job.body.savedCount).toBe(1);
    const detail = await api().get(`/api/places/${pinnedId}`).expect(200);
    expect(detail.body).toMatchObject({
      locationSource: 'user',
      createdByMe: true,
      address: '12 Trần Hưng Đạo',
    });
  });

  it('POST /places/user: ngoài vùng 400 PIN_OUTSIDE_REGION; lượt chia sẻ của người khác 404; ghi chú sai 400 không tạo điểm', async () => {
    await api()
      .post('/api/places/user')
      .send({
        name: 'E2E up Xa',
        category: 'food',
        lat: 10.77,
        lng: 106.7,
        regionId: daLat,
      })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('PIN_OUTSIDE_REGION'));
    await api(otherToken)
      .post('/api/places/user')
      .send({
        name: 'E2E up Lấn',
        category: 'food',
        lat: 11.94,
        lng: 108.44,
        regionId: daLat,
        shareImportId,
      })
      .expect(404);
    await api()
      .post('/api/places/user')
      .send({
        name: 'E2E up Giờ sai',
        category: 'food',
        lat: 11.94,
        lng: 108.44,
        regionId: daLat,
        notes: { openingHours: 'cả ngày' },
      })
      .expect(400);
    const [{ n }] = (await db.query(
      `SELECT count(*)::int AS n FROM places WHERE name = 'E2E up Giờ sai'`,
    )) as Array<{ n: number }>;
    expect(n).toBe(0);
  });

  it('POST /places/user: quá 30 điểm trong 24 giờ → 429 PIN_LIMIT', async () => {
    await db.query(
      `INSERT INTO places (source, name, category, location, location_source, created_by)
       SELECT 'user', 'E2E up Hàng loạt ' || g, 'food', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 'user', $1
         FROM generate_series(1, 30) g`,
      [otherId],
    );
    await api(otherToken)
      .post('/api/places/user')
      .send({
        name: 'E2E up Thứ 31',
        category: 'food',
        lat: 11.94,
        lng: 108.44,
        regionId: daLat,
      })
      .expect(429)
      .expect((r) => expect(r.body.code).toBe('PIN_LIMIT'));
  });

  it('PATCH /places/user/:id: người tạo sửa được; người khác 404; vị trí mới ngoài vùng 400', async () => {
    await api()
      .patch(`/api/places/user/${pinnedId}`)
      .send({ name: 'E2E up Chè bà Tư', lat: 11.95, lng: 108.45 })
      .expect(204);
    await api(otherToken)
      .patch(`/api/places/user/${pinnedId}`)
      .send({ name: 'E2E up Đổi trộm' })
      .expect(404);
    await api()
      .patch(`/api/places/user/${pinnedId}`)
      .send({ lat: 10.77, lng: 106.7 })
      .expect(400);
    const detail = await api().get(`/api/places/${pinnedId}`).expect(200);
    expect(detail.body.name).toBe('E2E up Chè bà Tư');
    expect(detail.body.coordinates.lat).toBeCloseTo(11.95);
  });

  it('cách ly: điểm tự ghim không có trong danh sách vùng, tìm theo tên, khớp danh mục', async () => {
    const list = await api(otherToken).get(`/api/regions/${daLat}/places`);
    expect(JSON.stringify(list.body)).not.toContain(pinnedId);
    const search = await api(otherToken)
      .get(
        `/api/regions/${daLat}/places/search?q=${encodeURIComponent('Chè bà Tư')}`,
      )
      .expect(200);
    expect(JSON.stringify(search.body)).not.toContain(pinnedId);
    const matches = await matchCatalog(db, ['E2E up Chè bà Tư'], null, 0.3);
    expect(matches.map((m) => m.id)).not.toContain(pinnedId);
  });
  it('GET /places/reverse-geocode: trả một dòng địa chỉ; cùng ô 10 m lấy cache; Nominatim lỗi thì null', async () => {
    openData.reverse.mockResolvedValueOnce({
      address: { road: 'Đường Hồ Tùng Mậu', city: 'Đà Lạt', state: 'Lâm Đồng' },
    });
    await api()
      .get('/api/places/reverse-geocode?lat=11.9401&lng=108.4402')
      .expect(200)
      .expect((r) =>
        expect(r.body).toEqual({
          address: 'Đường Hồ Tùng Mậu, Đà Lạt, Lâm Đồng',
        }),
      );
    await api()
      .get('/api/places/reverse-geocode?lat=11.94012&lng=108.44018')
      .expect(200);
    expect(openData.reverse).toHaveBeenCalledTimes(1);
    openData.reverse.mockResolvedValueOnce(null);
    await api()
      .get('/api/places/reverse-geocode?lat=11.95&lng=108.45')
      .expect(200)
      .expect((r) => expect(r.body).toEqual({ address: null }));
    await api()
      .get('/api/places/reverse-geocode?lat=200&lng=108.45')
      .expect(400);
  });
  it('lịch trình: thành viên nhóm và link công khai thấy ghi chú của người tạo; giờ ghi chú sinh cảnh báo đóng cửa', async () => {
    // Người tạo ghi chú: quán chỉ mở 06:00–09:00.
    await api()
      .patch(`/api/places/${webPlaceId}/notes`)
      .send({ note: 'Đi sớm', openingHours: 'Mo-Su 06:00-09:00' })
      .expect(200);
    // Thành viên có ghi chú riêng khác: không được hiện trong lịch trình của người tạo.
    await api(otherToken)
      .patch(`/api/places/${webPlaceId}/notes`)
      .send({ note: 'Của thành viên' })
      .expect(200);
    groupId = (
      await api().post('/api/groups').send({ name: 'E2E up nhóm' }).expect(201)
    ).body.id as string;
    await db.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'editor')`,
      [groupId, otherId],
    );
    const created = await api()
      .post('/api/itineraries')
      .send({
        regionId: daLat,
        planningMode: 'manual',
        startsAt: '2026-11-01T08:00:00+07:00',
        endsAt: '2026-11-01T21:00:00+07:00',
        travelParty: 'friends',
        adults: 2,
        children: 0,
        selectedPlaceIds: [webPlaceId],
        groupId,
      })
      .expect(201);
    const { id, days } = created.body as {
      id: string;
      days: Array<{ id: string }>;
    };
    // Xếp vào 14:00, ngoài giờ mở cửa trong ghi chú: PUT tính lại giờ và cảnh báo.
    const updated = await api()
      .put(`/api/itineraries/${id}`)
      .send({
        days: days.map((d, i) => ({
          id: d.id,
          items:
            i === 0
              ? [
                  {
                    kind: 'visit',
                    placeId: webPlaceId,
                    durationMinutes: 60,
                    startTime: '14:00',
                  },
                ]
              : [],
        })),
        unscheduledPlaceIds: [],
      })
      .expect(200);
    expect(
      updated.body.warnings.map((w: { type: string }) => w.type),
    ).toContain('place_closed');

    const stopOf = (body: {
      days: Array<{
        items: Array<{ placeId: string; place: { notes?: unknown } }>;
      }>;
    }) => body.days[0].items.find((i) => i.placeId === webPlaceId)!;
    const asMember = await api(otherToken)
      .get(`/api/itineraries/${id}`)
      .expect(200);
    expect(stopOf(asMember.body).place.notes).toMatchObject({
      note: 'Đi sớm',
      openingHours: 'Mo-Su 06:00-09:00',
    });

    const link = await api()
      .post(`/api/itineraries/${id}/share-link`)
      .expect(201);
    const pub = await request(app.getHttpServer())
      .get(`/api/public/itineraries/${link.body.token}`)
      .expect(200);
    expect(stopOf(pub.body).place.notes).toMatchObject({ note: 'Đi sớm' });

    // Người tạo sửa ghi chú → lần đọc sau thấy ngay (một bản, không chép).
    await api()
      .patch(`/api/places/${webPlaceId}/notes`)
      .send({ note: 'Đi trước 8h' })
      .expect(200);
    const again = await api(otherToken)
      .get(`/api/itineraries/${id}`)
      .expect(200);
    expect(stopOf(again.body).place.notes).toMatchObject({
      note: 'Đi trước 8h',
    });
    // Ghi chú không nằm trong dữ liệu đã lưu của lịch trình.
    const [{ days: stored }] = (await db.query(
      `SELECT days FROM itineraries WHERE id = $1`,
      [id],
    )) as Array<{
      days: unknown;
    }>;
    expect(JSON.stringify(stored)).not.toContain('Đi trước 8h');
  });
  it('lịch trình: dời ghim thì lịch trình thấy vị trí mới', async () => {
    const created = await api()
      .post('/api/itineraries')
      .send({
        regionId: daLat,
        planningMode: 'manual',
        startsAt: '2026-11-02T08:00:00+07:00',
        endsAt: '2026-11-02T21:00:00+07:00',
        travelParty: 'friends',
        adults: 2,
        children: 0,
        selectedPlaceIds: [pinnedId],
      })
      .expect(201);
    const { id, days } = created.body as {
      id: string;
      days: Array<{ id: string }>;
    };
    await api()
      .put(`/api/itineraries/${id}`)
      .send({
        days: days.map((d, i) => ({
          id: d.id,
          items:
            i === 0
              ? [{ kind: 'visit', placeId: pinnedId, durationMinutes: 60 }]
              : [],
        })),
        unscheduledPlaceIds: [],
      })
      .expect(200);
    await api()
      .patch(`/api/places/user/${pinnedId}`)
      .send({ lat: 11.96, lng: 108.46 })
      .expect(204);
    const res = await api().get(`/api/itineraries/${id}`).expect(200);
    const stop = res.body.days[0].items.find(
      (i: { placeId: string }) => i.placeId === pinnedId,
    );
    expect(stop.place.coordinates.lat).toBeCloseTo(11.96);
    expect(stop.place.locationSource).toBe('user');
  });
});
