import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';

/**
 * Chạy trên database thật (PostGIS) như health.e2e-spec. Gemini được thay bằng
 * bản giả để kiểm tra phần code quanh AI: kiểm tra phương án, xếp giờ, dự phòng.
 */
describe('Lịch trình (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let token: string;
  let otherToken: string;
  let regionId: string;
  const planItinerary = vi.fn();
  const ids: Record<string, string> = {};

  const places: Array<[string, string, number, number, string | null, number]> =
    [
      // key, category, lat, lng, opening_hours, score
      ['ho', 'nature', 11.9404, 108.4383, '24/7', 80],
      ['ga', 'culture', 11.9422, 108.4556, 'Mo-Su 07:00-17:00', 70],
      ['thung_lung', 'nature', 11.9775, 108.4474, null, 65],
      ['datanla', 'nature', 11.9007, 108.4494, 'Mo-Su 07:00-17:00', 60],
      ['dinh3', 'culture', 11.9311, 108.4297, 'Mo-Su 07:00-17:00', 55],
      ['vuon', 'kids', 11.9496, 108.4533, 'Mo-Su 07:30-18:00', 50],
      ['cho_dem', 'nightlife', 11.9426, 108.4371, 'Mo-Su 17:00-23:00', 45],
      ['view', 'check_in', 11.925, 108.46, null, 40],
      ['com1', 'food', 11.941, 108.439, null, 30],
      ['com2', 'food', 11.945, 108.45, null, 30],
      ['com3', 'food', 11.935, 108.444, null, 30],
      ['com4', 'food', 11.95, 108.445, null, 30],
      ['cafe', 'cafe', 11.943, 108.441, null, 35],
      ['hotel', 'stay', 11.944, 108.442, null, 20],
    ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary, findPlaces: vi.fn() })
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
      `INSERT INTO users (display_name) VALUES ('e2e'), ('e2e-other') RETURNING id`,
    )) as Array<{ id: string }>;
    token = jwt.sign({ sub: user.id });
    otherToken = jwt.sign({ sub: other.id });

    [{ id: regionId }] = (await db.query(
      `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
    )) as Array<{ id: string }>;

    for (const [
      i,
      [key, category, lat, lng, hours, score],
    ] of places.entries()) {
      const [row] = (await db.query(
        `INSERT INTO places (osm_type, osm_id, name, category, location, tags, composite_score)
         VALUES ('node', $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7)
         ON CONFLICT (osm_type, osm_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [
          -9000 - i,
          `E2E ${key}`,
          category,
          lng,
          lat,
          hours ? { opening_hours: hours } : {},
          score,
        ],
      )) as Array<{ id: string }>;
      ids[key] = row.id;
    }
  });

  afterAll(async () => {
    await db?.query(
      `DELETE FROM users WHERE display_name IN ('e2e', 'e2e-other')`,
    );
    await db?.query(
      `DELETE FROM places WHERE osm_id <= -9000 AND osm_id > -9100`,
    );
    await app?.close();
  });

  const create = (body: object, as = token) =>
    request(app.getHttpServer())
      .post('/api/itineraries')
      .set('Authorization', `Bearer ${as}`)
      .send(body);

  const baseBody = () => ({
    regionId,
    planningMode: 'ai',
    startsAt: '2026-10-05T08:00:00+07:00',
    endsAt: '2026-10-06T18:00:00+07:00',
    travelParty: 'family_with_kids',
    adults: 2,
    children: 1,
    selectedPlaceIds: [ids.ga, ids.datanla, ids.com1],
    accommodationPlaceId: ids.hotel,
  });

  it('AI xếp lịch: bỏ id AI bịa, giữ mọi điểm đã chọn, có bữa ăn và nghỉ trưa', async () => {
    // AI giả: bịa một id, chọn một điểm bổ sung có trong danh sách được gửi,
    // và một điểm có trong database nhưng không được gửi cho AI.
    let aiPick = '';
    planItinerary.mockImplementationOnce(
      async (_system: string, req: string) => {
        const offered = JSON.parse(req.split('\n').at(-1)!) as Array<{
          id: string;
          required: boolean;
        }>;
        aiPick = offered.find((p) => !p.required && p.id !== ids.vuon)!.id;
        const stop = (placeId: string, reason: string) => ({
          placeId,
          visitMinutes: 90,
          reason,
          openingHours: '',
        });
        return {
          days: [
            {
              dayIndex: 0,
              stops: [
                stop(ids.ga, 'Đi sớm tránh nắng'),
                stop('bịa-bởi-ai', 'x'),
              ],
            },
            {
              dayIndex: 1,
              stops: [
                stop(aiPick, 'Hợp với bé'),
                ...(offered.some((p) => p.id === ids.vuon)
                  ? []
                  : [stop(ids.vuon, 'không được gửi')]),
              ],
            },
          ],
          tips: ['Đà Lạt tối lạnh, mang áo ấm'],
        };
      },
    );

    const res = await create(baseBody()).expect(201);
    const it = res.body;

    expect(it.planner).toBe('ai');
    expect(it.tips).toEqual(['Đà Lạt tối lạnh, mang áo ấm']);
    expect(planItinerary.mock.calls[0][1]).toContain('gia đình có trẻ nhỏ');

    const items = it.days.flatMap(
      (d: { items: Array<Record<string, unknown>> }) => d.items,
    );
    const placeIds = items
      .map((i: { placeId: string | null }) => i.placeId)
      .filter(Boolean);
    // FR-6.3: mọi địa điểm đều có trong danh mục.
    const known = new Set(Object.values(ids));
    expect(placeIds.every((id: string) => known.has(id))).toBe(true);
    // 100% điểm đã chọn hoặc trong lịch, hoặc trong "Chưa xếp được".
    const unscheduled = it.unscheduled.map(
      (u: { placeId: string }) => u.placeId,
    );
    for (const id of [ids.ga, ids.datanla]) {
      expect(placeIds.includes(id) || unscheduled.includes(id)).toBe(true);
    }
    // Quán đã chọn được dùng cho bữa ăn.
    expect(
      items.some(
        (i: { kind: string; placeId: string }) =>
          i.kind === 'meal' && i.placeId === ids.com1,
      ),
    ).toBe(true);
    expect(items.some((i: { kind: string }) => i.kind === 'rest')).toBe(true);
    expect(
      items.find((i: { placeId: string }) => i.placeId === ids.ga),
    ).toMatchObject({
      reason: 'Đi sớm tránh nắng',
      isAiSuggested: false,
    });
    expect(
      items.find((i: { placeId: string }) => i.placeId === aiPick),
    ).toMatchObject({ reason: 'Hợp với bé', isAiSuggested: true });
    // Id có trong database nhưng không được gửi cho AI thì cũng bị bỏ.
    const offeredVuon = (planItinerary.mock.calls[0][1] as string).includes(
      ids.vuon,
    );
    if (!offeredVuon) expect(placeIds).not.toContain(ids.vuon);

    // Mỗi mục đều có giờ hợp lệ, tăng dần trong ngày.
    for (const day of it.days) {
      const times = day.items.map((i: { startsAt: string; endsAt: string }) => [
        Date.parse(i.startsAt),
        Date.parse(i.endsAt),
      ]);
      times.forEach(([s, e]: number[], k: number) => {
        expect(e).toBeGreaterThan(s);
        if (k > 0) expect(s).toBeGreaterThanOrEqual(times[k - 1][1]);
      });
    }

    const again = await request(app.getHttpServer())
      .get(`/api/itineraries/${it.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(again.body.days).toEqual(it.days);

    const list = await request(app.getHttpServer())
      .get('/api/itineraries')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body[0]).toMatchObject({
      id: it.id,
      dayCount: 2,
      planner: 'ai',
    });

    await request(app.getHttpServer())
      .get(`/api/itineraries/${it.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('Gemini lỗi → vẫn có lịch bằng thuật toán', async () => {
    planItinerary.mockRejectedValueOnce(new Error('quota exceeded'));

    const res = await create({
      ...baseBody(),
      travelParty: 'friends',
      accommodationPlaceId: undefined,
    }).expect(201);

    expect(res.body.planner).toBe('heuristic');
    const visits = res.body.days
      .flatMap((d: { items: Array<{ kind: string }> }) => d.items)
      .filter((i: { kind: string }) => i.kind === 'visit');
    expect(visits.length).toBeGreaterThanOrEqual(3);
  });

  it('tự sắp xếp: ngày trống, điểm đã chọn nằm chờ, cảnh báo thiếu bữa', async () => {
    const res = await create({ ...baseBody(), planningMode: 'manual' }).expect(
      201,
    );

    expect(res.body.planner).toBe('manual');
    expect(
      res.body.days.every((d: { items: unknown[] }) => d.items.length === 0),
    ).toBe(true);
    expect(
      res.body.unscheduled.map((u: { placeId: string }) => u.placeId).sort(),
    ).toEqual([ids.ga, ids.datanla].sort());
    expect(
      res.body.warnings.every(
        (w: { type: string }) => w.type === 'missing_meal',
      ),
    ).toBe(true);
  });

  it('sửa lịch trình: giữ thứ tự, tính lại giờ, chuyển điểm ra "Chưa xếp"', async () => {
    const created = await create({
      ...baseBody(),
      planningMode: 'manual',
    }).expect(201);
    const { id, days } = created.body as {
      id: string;
      days: Array<{ id: string }>;
    };
    const put = (body: object, as = token) =>
      request(app.getHttpServer())
        .put(`/api/itineraries/${id}`)
        .set('Authorization', `Bearer ${as}`)
        .send(body);

    const res = await put({
      days: days.map((d, i) => ({
        id: d.id,
        items:
          i === 0
            ? [
                { kind: 'visit', placeId: ids.datanla, durationMinutes: 90 },
                {
                  kind: 'meal',
                  mealType: 'lunch',
                  placeId: ids.com1,
                  durationMinutes: 60,
                  startTime: '12:00',
                },
              ]
            : [],
      })),
      unscheduledPlaceIds: [ids.ga],
    }).expect(200);

    const [first] = res.body.days;
    expect(first.items.map((i: { placeId: string }) => i.placeId)).toEqual([
      ids.datanla,
      ids.com1,
    ]);
    expect(first.items[1].startsAt).toMatch(/T12:00:00\+07:00$/);
    expect(first.items[1].fixedStart).toBe(true);
    expect(first.items[1].travelMinutesFromPrevious).toBeGreaterThan(0);
    expect(first.items[0].place.name).toBe('E2E datanla');
    expect(res.body.unscheduled).toEqual([
      { placeId: ids.ga, name: 'E2E ga', reason: 'Chờ bạn xếp vào lịch' },
    ]);

    const again = await request(app.getHttpServer())
      .get(`/api/itineraries/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(again.body.days[0].items).toHaveLength(2);

    // Sai số ngày, địa điểm lạ, lịch trình của người khác.
    const wrongDays = await put({ days: [], unscheduledPlaceIds: [] }).expect(
      400,
    );
    expect(wrongDays.body.code).toBe('DAYS_MISMATCH');
    const unknown = await put({
      days: days.map((d) => ({ id: d.id, items: [] })),
      unscheduledPlaceIds: ['00000000-0000-0000-0000-000000000000'],
    }).expect(400);
    expect(unknown.body.code).toBe('UNKNOWN_PLACES');
    await put(
      {
        days: days.map((d) => ({ id: d.id, items: [] })),
        unscheduledPlaceIds: [],
      },
      otherToken,
    ).expect(404);

    // Đổi điểm tương tự: cùng loại, chưa có trong lịch trình.
    const alt = await request(app.getHttpServer())
      .get(`/api/itineraries/${id}/alternatives`)
      .query({ placeId: ids.ga })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(alt.body.length).toBeGreaterThan(0);
    expect(alt.body.length).toBeLessThanOrEqual(3);
    for (const a of alt.body as Array<{ id: string; category: string }>) {
      expect(a.category).toBe('culture');
      expect([ids.ga, ids.datanla, ids.com1]).not.toContain(a.id);
    }
  });

  it.each([
    [{ endsAt: '2026-10-04T08:00:00+07:00' }, 'INVALID_DATES'],
    [{ endsAt: '2026-10-20T08:00:00+07:00' }, 'TRIP_TOO_LONG'],
    [
      { selectedPlaceIds: ['00000000-0000-0000-0000-000000000000'] },
      'UNKNOWN_PLACES',
    ],
    [{ accommodationPlaceId: 'ga' }, undefined],
  ])('từ chối dữ liệu sai: %o', async (patch, code) => {
    const body = { ...baseBody(), ...patch };
    if ('accommodationPlaceId' in patch) body.accommodationPlaceId = ids.ga; // không phải "stay"
    const res = await create(body).expect(400);
    expect(res.body.code).toBe(code ?? 'INVALID_ACCOMMODATION');
  });
});
