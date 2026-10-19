import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';
import { RecommendationsQueue } from '../src/modules/recommendations/queue/recommendations-queue.js';
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary, suggestThemes })
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
});
