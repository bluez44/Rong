import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';
import { RecommendationsQueue } from '../src/modules/recommendations/queue/recommendations-queue.js';
import { addDays, vietnamDate } from '../src/modules/recommendations/draft-dates.js';
import { UnsplashClient } from '../src/modules/recommendations/unsplash.client.js';
import { OpenMeteoClient, WEATHER_CONFIG } from '../src/modules/weather/open-meteo.client.js';
import {
  cleanupRecommendationRegions,
  seedRecommendationRegions,
  type RecommendationRegionsFixture,
} from './fixtures/recommendation-regions.js';

describe('Gợi ý trang chủ (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let jwt: JwtService;
  let queue: RecommendationsQueue;
  let fixture: RecommendationRegionsFixture;
  let regions: RecommendationRegionsFixture['regions'];
  const planItinerary = vi.fn();
  const suggestThemes = vi.fn();
  const forecast = vi.fn();
  const archive = vi.fn();
  // Tắt mặc định: các test cũ thấy `weather: null` mà không gọi client (lỗi sẽ bị nhớ 5 phút); test thời tiết bật lên.
  const weatherConfig = { enabled: false, forecastUrl: '', archiveUrl: '', contactEmail: 'e2e@rong.local', climateDailyLimit: 25 };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary, suggestThemes })
      .overrideProvider(UnsplashClient)
      .useValue({ enabled: false, searchLandscape: async () => null })
      .overrideProvider(OpenMeteoClient)
      .useValue({ forecast, archive })
      .overrideProvider(WEATHER_CONFIG)
      .useValue(weatherConfig)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    db = app.get(DataSource);
    jwt = app.get(JwtService);
    queue = app.get(RecommendationsQueue);
    fixture = await seedRecommendationRegions(db, 'api');
    regions = fixture.regions;
  });

  // e2e không bao giờ gọi mạng: client luôn là bản giả, mặc định lỗi.
  beforeEach(() => {
    weatherConfig.enabled = false;
    forecast.mockReset().mockRejectedValue(new Error('offline'));
    archive.mockReset().mockRejectedValue(new Error('offline'));
  });

  afterAll(async () => {
    await queue?.idle();
    await db?.query(`DELETE FROM users WHERE display_name LIKE 'e2e-rec-api%'`);
    await cleanupRecommendationRegions(db, fixture);
    await app?.close();
  });

  const newUser = async (suffix = '') => {
    const [user] = (await db.query(
      `INSERT INTO users (display_name) VALUES ($1) RETURNING id`,
      [`e2e-rec-api${suffix}`],
    )) as Array<{ id: string }>;
    const [theme] = (await db.query(
      `INSERT INTO user_themes (user_id, label, icon, categories, region_ids, expires_at)
       VALUES ($1, 'E2E chủ đề', 'sparkles', '{nature,culture,check_in,cafe,kids}', $2::uuid[], now() + interval '7 days')
       RETURNING id`,
      [user.id, regions.map((r) => r.id)],
    )) as Array<{ id: string }>;
    return { id: user.id, token: jwt.sign({ sub: user.id }), theme: `user:${theme.id}` };
  };

  const api = (token: string) => ({
    get: (path: string) =>
      request(app.getHttpServer()).get(`/api${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body: object) =>
      request(app.getHttpServer()).post(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body),
  });

  /** Gọi feed tới khi `ready` (job chạy trong process). */
  const readyFeed = async (token: string, theme: string) => {
    const first = await api(token).get(`/recommendations?theme=${encodeURIComponent(theme)}`).expect(200);
    if (first.body.status === 'ready') return first.body;
    await queue.idle();
    const second = await api(token).get(`/recommendations?theme=${encodeURIComponent(theme)}`).expect(200);
    expect(second.body.status).toBe('ready');
    return second.body;
  };

  it('lần đầu building, sau đó ready với 3 thẻ; danh sách chủ đề có "Dành cho bạn" đầu tiên', async () => {
    const u = await newUser();
    const first = await api(u.token).get(`/recommendations?theme=${encodeURIComponent(u.theme)}`).expect(200);
    expect(first.body.status).toBe('building');
    expect(first.body.items).toEqual([]);
    expect(first.body.themes[0]).toMatchObject({ key: 'default', kind: 'default' });
    expect(first.body.themes[1]).toMatchObject({ key: u.theme, kind: 'personal' });
    expect(first.body.themes[1].regionHint).toContain('Đà Lạt');

    const feed = await readyFeed(u.token, u.theme);
    expect(feed.items).toHaveLength(3);
    const card = feed.items[0];
    expect(card).toMatchObject({ dayCount: 2, nightCount: 1, estimatedCost: null, weather: null, savedItineraryId: null });
    expect(card.title).toContain('E2E chủ đề');
    expect(card.highlights.length).toBeGreaterThan(0);
    expect(new Date(card.startsAt).getUTCDay()).toBe(6); // 8:00 +07:00 thứ Bảy vẫn là thứ Bảy UTC
    expect(Date.parse(feed.nextRefreshAt)).toBeGreaterThan(Date.parse(feed.windowStart));
    expect(planItinerary).not.toHaveBeenCalled();
  });

  it('xem bản nháp, đổi thông số → bản nháp mới; chỉ đổi ngày → giữ bản nháp', async () => {
    const u = await newUser();
    const feed = await readyFeed(u.token, u.theme);
    const id = feed.items[0].id;

    const draft = await api(u.token).get(`/recommendations/${id}`).expect(200);
    expect(draft.body).toMatchObject({ recommendationId: id, planner: 'heuristic', savedItineraryId: null });
    expect(draft.body.days).toHaveLength(2);
    expect(draft.body.days[0].date).toBe(feed.items[0].startsAt.slice(0, 10));

    // Xem lại cùng một gợi ý không được tăng view_count thêm lần nữa
    // (viewed_at chỉ được set một lần — ngưỡng nâng cấp Gemini dựa vào đây).
    const viewCount = async () =>
      (
        (await db.query(`SELECT view_count FROM itinerary_drafts WHERE id = $1`, [draft.body.draftId])) as Array<{
          view_count: number;
        }>
      )[0].view_count;
    expect(await viewCount()).toBe(1);
    await api(u.token).get(`/recommendations/${id}`).expect(200);
    expect(await viewCount()).toBe(1);

    const params = { ...draft.body.params };
    const nextWeek = new Date(Date.parse(`${draft.body.days[0].date}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const sameDraft = await api(u.token)
      .post(`/recommendations/${id}/preview`, { ...params, startDate: nextWeek })
      .expect(201);
    expect(sameDraft.body.draftId).toBe(draft.body.draftId);
    expect(sameDraft.body.days[0].date).toBe(nextWeek);

    const longer = await api(u.token)
      .post(`/recommendations/${id}/preview`, { ...params, startDate: nextWeek, daysCount: 3, travelParty: 'friends' })
      .expect(201);
    expect(longer.body.draftId).not.toBe(draft.body.draftId);
    expect(longer.body.days).toHaveLength(3);
    expect(longer.body.params).toMatchObject({ daysCount: 3, travelParty: 'friends' });
  });

  it('preview sai thông số → 400, không đổi bản nháp', async () => {
    const u = await newUser();
    const feed = await readyFeed(u.token, u.theme);
    const id = feed.items[0].id;
    const draft = await api(u.token).get(`/recommendations/${id}`).expect(200);
    const base = { ...draft.body.params, startDate: draft.body.days[0].date };

    await api(u.token).post(`/recommendations/${id}/preview`, { ...base, daysCount: 8 }).expect(400);
    await api(u.token).post(`/recommendations/${id}/preview`, { ...base, startDate: '2026-02-30' }).expect(400);
    const past = await api(u.token).post(`/recommendations/${id}/preview`, { ...base, startDate: '2020-01-04' }).expect(400);
    expect(past.body.code).toBe('INVALID_DATES');
    // Hôm nay chỉ chọn được khi 8:00 (giờ Việt Nam) chưa qua.
    const vnNow = new Date(Date.now() + 7 * 3_600_000);
    if (vnNow.getUTCHours() >= 8) {
      const today = vnNow.toISOString().slice(0, 10);
      const late = await api(u.token).post(`/recommendations/${id}/preview`, { ...base, startDate: today }).expect(400);
      expect(late.body.code).toBe('INVALID_DATES');
    }

    const after = await api(u.token).get(`/recommendations/${id}`).expect(200);
    expect(after.body.draftId).toBe(draft.body.draftId);
  });

  it('lưu: tạo lịch trình (201), không trừ lượt AI; lưu lần hai trả lại lịch trình đó (200)', async () => {
    const u = await newUser();
    const feed = await readyFeed(u.token, u.theme);
    const id = feed.items[1].id;
    const draft = await api(u.token).get(`/recommendations/${id}`).expect(200);

    const saved = await api(u.token).post(`/recommendations/${id}/save`, { draftId: draft.body.draftId }).expect(201);
    expect(saved.body).toMatchObject({ ownerId: u.id, aiEditsRemaining: 3, planner: 'heuristic' });
    expect(saved.body.days[0].date).toBe(draft.body.days[0].date);

    const [{ ai_generations_used }] = (await db.query(
      `SELECT ai_generations_used FROM users WHERE id = $1`,
      [u.id],
    )) as Array<{ ai_generations_used: number }>;
    expect(ai_generations_used).toBe(0);

    const again = await api(u.token).post(`/recommendations/${id}/save`, { draftId: draft.body.draftId }).expect(200);
    expect(again.body.id).toBe(saved.body.id);

    const feedAfter = await api(u.token).get(`/recommendations?theme=${encodeURIComponent(u.theme)}`).expect(200);
    expect(feedAfter.body.items.find((c: { id: string }) => c.id === id).savedItineraryId).toBe(saved.body.id);
  });

  it('lịch trình đã lưu bị xóa → thẻ hết "Đã lưu", lưu lại tạo lịch trình mới', async () => {
    const u = await newUser();
    const feed = await readyFeed(u.token, u.theme);
    const id = feed.items[0].id;
    const draft = await api(u.token).get(`/recommendations/${id}`).expect(200);
    const saved = await api(u.token).post(`/recommendations/${id}/save`, { draftId: draft.body.draftId }).expect(201);
    await request(app.getHttpServer())
      .delete(`/api/itineraries/${saved.body.id}`)
      .set('Authorization', `Bearer ${u.token}`)
      .expect(204);

    const feedAfter = await api(u.token).get(`/recommendations?theme=${encodeURIComponent(u.theme)}`).expect(200);
    expect(feedAfter.body.items.find((c: { id: string }) => c.id === id).savedItineraryId).toBeNull();
    const again = await api(u.token).post(`/recommendations/${id}/save`, { draftId: draft.body.draftId }).expect(201);
    expect(again.body.id).not.toBe(saved.body.id);
  });

  it('dời sang thứ khác → cảnh báo tính lại theo ngày thật (đóng cửa thứ Hai); lưu giữ cảnh báo đó', async () => {
    const u = await newUser();
    const feed = await readyFeed(u.token, u.theme);
    const id = feed.items[0].id;
    const draft = await api(u.token).get(`/recommendations/${id}`).expect(200);
    const visit = draft.body.days[0].items.find((i: { kind: string }) => i.kind === 'visit');
    const [{ tags }] = (await db.query(`SELECT tags FROM places WHERE id = $1`, [visit.placeId])) as Array<{
      tags: Record<string, unknown> | null;
    }>;
    await db.query(
      `UPDATE places SET tags = COALESCE(tags, '{}'::jsonb) || '{"opening_hours": "Sa,Su 00:00-23:59; Mo-Fr off"}'::jsonb
        WHERE id = $1`,
      [visit.placeId],
    );
    try {
      const saturday = draft.body.days[0].date as string;
      const monday = new Date(Date.parse(`${saturday}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
      const closed = (w: { type: string; message: string }) =>
        w.type === 'place_closed' && w.message.includes(visit.place.name);

      const sameDay = await api(u.token)
        .post(`/recommendations/${id}/preview`, { ...draft.body.params, startDate: saturday })
        .expect(201);
      expect(sameDay.body.warnings.some(closed)).toBe(false);

      const moved = await api(u.token)
        .post(`/recommendations/${id}/preview`, { ...draft.body.params, startDate: monday })
        .expect(201);
      expect(moved.body.draftId).toBe(draft.body.draftId);
      expect(moved.body.days[0].date).toBe(monday);
      // Giờ giữ nguyên, chỉ cảnh báo được tính lại.
      const movedVisit = moved.body.days[0].items.find((i: { id: string }) => i.id === visit.id);
      expect(movedVisit.startsAt).toBe(visit.startsAt.replace(saturday, monday));
      expect(moved.body.warnings.some(closed)).toBe(true);

      const again = await api(u.token).get(`/recommendations/${id}`).expect(200);
      expect(again.body.warnings.some(closed)).toBe(true);

      const saved = await api(u.token).post(`/recommendations/${id}/save`, { draftId: moved.body.draftId }).expect(201);
      expect(saved.body.days[0].date).toBe(monday);
      expect(saved.body.warnings.some(closed)).toBe(true);
    } finally {
      await db.query(`UPDATE places SET tags = $2::jsonb WHERE id = $1`, [
        visit.placeId,
        tags === null ? null : JSON.stringify(tags),
      ]);
    }
  }, 20_000);

  it('lưu giữ tọa độ ảnh chụp của bản nháp, không lưu tọa độ Google đang hiển thị', async () => {
    const u = await newUser();
    const feed = await readyFeed(u.token, u.theme);
    const id = feed.items[2].id;
    const draft = await api(u.token).get(`/recommendations/${id}`).expect(200);
    const visit = draft.body.days[0].items.find((i: { kind: string }) => i.kind === 'visit');
    const snapshot = visit.place.coordinates as { lat: number; lng: number };
    expect(snapshot).not.toBeNull();
    await db.query(
      `UPDATE places SET location_source = 'google', google_place_id = 'e2e-rec-' || id::text,
              location_expires_at = now() + interval '1 day',
              location = ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)
        WHERE id = $1`,
      [visit.placeId, snapshot.lng + 0.1, snapshot.lat + 0.1],
    );
    try {
      const live = await api(u.token).get(`/recommendations/${id}`).expect(200);
      const liveVisit = live.body.days[0].items.find((i: { id: string }) => i.id === visit.id);
      expect(liveVisit.place.coordinates.lat).toBeCloseTo(snapshot.lat + 0.1);

      const saved = await api(u.token).post(`/recommendations/${id}/save`, { draftId: draft.body.draftId }).expect(201);
      const [{ days }] = (await db.query(`SELECT days FROM itineraries WHERE id = $1`, [saved.body.id])) as Array<{
        days: Array<{ items: Array<{ id: string; place: { coordinates: unknown } | null }> }>;
      }>;
      expect(days[0].items.find((i) => i.id === visit.id)!.place!.coordinates).toEqual(snapshot);
    } finally {
      await db.query(
        `UPDATE places SET location_source = 'ai', google_place_id = NULL, location_expires_at = NULL,
                location = ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)
          WHERE id = $1`,
        [visit.placeId, snapshot.lng, snapshot.lat],
      );
    }
  });

  it('hai lần lưu cùng lúc → đúng một lịch trình, một 201 và một 200 cùng id', async () => {
    const u = await newUser();
    const feed = await readyFeed(u.token, u.theme);
    const id = feed.items[0].id;
    const draft = await api(u.token).get(`/recommendations/${id}`).expect(200);
    const [a, b] = await Promise.all([
      api(u.token).post(`/recommendations/${id}/save`, { draftId: draft.body.draftId }),
      api(u.token).post(`/recommendations/${id}/save`, { draftId: draft.body.draftId }),
    ]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
    const [{ n }] = (await db.query(`SELECT count(*)::int AS n FROM itineraries WHERE owner_id = $1`, [u.id])) as Array<{
      n: number;
    }>;
    expect(n).toBe(1);
  });

  /** Lịch trình đã kết thúc của `userId` (thông số như bản nháp `draft`) chứa đúng một mục `item`. */
  const endedItinerary = async (
    userId: string,
    draft: { regionId: string; input: object; days: object[] },
    item: object,
  ) => {
    const [{ id }] = (await db.query(
      `INSERT INTO itineraries (owner_id, region_id, planner, starts_at, ends_at, input, days)
       VALUES ($1, $2, 'heuristic', now() - interval '3 days', now() - interval '2 days', $3::jsonb, $4::jsonb)
       RETURNING id`,
      [userId, draft.regionId, JSON.stringify(draft.input), JSON.stringify([{ ...draft.days[0], items: [item] }])],
    )) as Array<{ id: string }>;
    return id;
  };

  const review = (token: string, itineraryId: string, visitedPlaceIds: string[]) =>
    request(app.getHttpServer())
      .post('/api/visits/review')
      .set('Authorization', `Bearer ${token}`)
      .send({ itineraryId, visitedPlaceIds })
      .expect(204);

  it('xác nhận nơi đã đi → thẻ của khung giờ bị xóa, lần mở sau dựng lại không có nơi đó', async () => {
    const u = await newUser();
    const feed = await readyFeed(u.token, u.theme);
    const draft = await api(u.token).get(`/recommendations/${feed.items[0].id}`).expect(200);
    const visit = draft.body.days[0].items.find((i: { kind: string }) => i.kind === 'visit');
    const itineraryId = await endedItinerary(u.id, draft.body, visit);

    await review(u.token, itineraryId, [visit.placeId]);
    expect(await db.query(`SELECT id FROM user_recommendations WHERE user_id = $1`, [u.id])).toEqual([]);
    await api(u.token).get(`/recommendations/${feed.items[0].id}`).expect(404);

    // Job dựng cũ đã bị xóa: không trả "ready" rỗng mà dựng lại.
    const next = await api(u.token).get(`/recommendations?theme=${encodeURIComponent(u.theme)}`).expect(200);
    expect(next.body.status).toBe('building');
    const rebuilt = await readyFeed(u.token, u.theme);
    expect(rebuilt.items.length).toBeGreaterThan(0);
    for (const card of rebuilt.items as Array<{ id: string }>) {
      const d = await api(u.token).get(`/recommendations/${card.id}`).expect(200);
      const ids = (d.body.days as Array<{ items: Array<{ placeId: string | null }> }>).flatMap((day) =>
        day.items.map((i) => i.placeId),
      );
      expect(ids).not.toContain(visit.placeId);
    }
  }, 20_000);

  it('xác nhận nơi đã đi giữ lại thẻ đã lưu', async () => {
    const u = await newUser();
    const feed = await readyFeed(u.token, u.theme);
    const saved = feed.items[2];
    const savedDraft = await api(u.token).get(`/recommendations/${saved.id}`).expect(200);
    await api(u.token).post(`/recommendations/${saved.id}/save`, { draftId: savedDraft.body.draftId }).expect(201);

    const draft = await api(u.token).get(`/recommendations/${feed.items[0].id}`).expect(200);
    const visit = draft.body.days[0].items.find((i: { kind: string }) => i.kind === 'visit');
    const itineraryId = await endedItinerary(u.id, draft.body, visit);

    await review(u.token, itineraryId, [visit.placeId]);
    const rows = (await db.query(`SELECT id FROM user_recommendations WHERE user_id = $1`, [u.id])) as Array<{
      id: string;
    }>;
    expect(rows.map((r) => r.id)).toEqual([saved.id]);
    await queue.idle();
  });

  it('draftId cũ → DRAFT_NOT_FOUND; người khác → RECOMMENDATION_NOT_FOUND; chủ đề lạ → UNKNOWN_THEME', async () => {
    const u = await newUser();
    const other = await newUser('-other');
    const feed = await readyFeed(u.token, u.theme);
    const id = feed.items[0].id;

    const wrong = await api(u.token)
      .post(`/recommendations/${id}/save`, { draftId: '00000000-0000-4000-8000-000000000000' })
      .expect(404);
    expect(wrong.body.code).toBe('DRAFT_NOT_FOUND');

    const hidden = await api(other.token).get(`/recommendations/${id}`).expect(404);
    expect(hidden.body.code).toBe('RECOMMENDATION_NOT_FOUND');

    const theme = await api(other.token).get(`/recommendations?theme=${encodeURIComponent(u.theme)}`).expect(400);
    expect(theme.body.code).toBe('UNKNOWN_THEME');
    await api(u.token).get('/recommendations?theme=fixed:khong-co').expect(400);
  });

  it('không đủ vùng → ready rỗng, không kẹt building', async () => {
    const u = await newUser();
    // Chủ đề chỉ gồm danh mục Về đêm: fixture không có điểm nào → mọi vùng bị loại.
    const [row] = (await db.query(
      `INSERT INTO user_themes (user_id, label, icon, categories, region_ids, expires_at)
       VALUES ($1, 'E2E rỗng', 'nightlife', '{nightlife}', $2::uuid[], now() + interval '7 days') RETURNING id`,
      [u.id, regions.map((r) => r.id)],
    )) as Array<{ id: string }>;
    const theme = `user:${row.id}`;
    const feed = await readyFeed(u.token, theme);
    expect(feed.items).toEqual([]);
  });

  it('cập nhật last_seen_at', async () => {
    const u = await newUser();
    await db.query(`UPDATE users SET last_seen_at = now() - interval '2 days' WHERE id = $1`, [u.id]);
    await api(u.token).get(`/recommendations?theme=${encodeURIComponent(u.theme)}`).expect(200);
    const [{ recent }] = (await db.query(
      `SELECT last_seen_at > now() - interval '1 minute' AS recent FROM users WHERE id = $1`,
      [u.id],
    )) as Array<{ recent: boolean }>;
    expect(recent).toBe(true);
    await queue.idle();
  });
  it('thẻ có tóm tắt thời tiết khi Open-Meteo trả dữ liệu', async () => {
    weatherConfig.enabled = true;
    forecast.mockImplementation(async () => {
      const today = vietnamDate(new Date());
      const time = Array.from({ length: 16 }, (_, i) => addDays(today, i));
      return {
        time,
        weather_code: time.map(() => 2),
        temperature_2m_max: time.map(() => 31),
        temperature_2m_min: time.map(() => 24),
        precipitation_probability_max: time.map(() => 20),
      };
    });
    archive.mockImplementation(async (_lat: number, _lng: number, from: string, to: string) => {
      const time: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) time.push(d);
      return {
        time,
        temperature_2m_max: time.map(() => 29),
        temperature_2m_min: time.map(() => 21),
        precipitation_sum: time.map(() => 0),
      };
    });
    const u = await newUser('-weather');
    const feed = await readyFeed(u.token, u.theme);
    expect(feed.items[0].weather).toMatchObject({
      condition: 'partly_cloudy',
      tempMax: expect.any(Number),
      tempMin: expect.any(Number),
    });
  });
});
