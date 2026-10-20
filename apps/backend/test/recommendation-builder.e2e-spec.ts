import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';
import { RecommendationsQueue } from '../src/modules/recommendations/queue/recommendations-queue.js';
import { RecommendationBuilder } from '../src/modules/recommendations/recommendation-builder.js';
import { UnsplashClient } from '../src/modules/recommendations/unsplash.client.js';
import { windowFor } from '../src/modules/recommendations/window.js';
import {
  cleanupRecommendationRegions,
  seedRecommendationRegions,
  type FixtureRegion,
  type RecommendationRegionsFixture,
} from './fixtures/recommendation-regions.js';

describe('RecommendationBuilder (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let builder: RecommendationBuilder;
  let fixture: RecommendationRegionsFixture;
  let regions: FixtureRegion[];
  const planItinerary = vi.fn();
  const suggestThemes = vi.fn();
  const { windowStart } = windowFor(new Date());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary, suggestThemes })
      .overrideProvider(UnsplashClient)
      .useValue({ enabled: false, searchLandscape: async () => null })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DataSource);
    builder = app.get(RecommendationBuilder);
    fixture = await seedRecommendationRegions(db, 'builder');
    regions = fixture.regions;
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM users WHERE display_name LIKE 'e2e-rec-builder%'`);
    await cleanupRecommendationRegions(db, fixture);
    await app?.close();
  });

  const newUser = async () => {
    const [user] = (await db.query(
      `INSERT INTO users (display_name) VALUES ('e2e-rec-builder') RETURNING id`,
    )) as Array<{ id: string }>;
    return user.id;
  };

  /** Chủ đề riêng gồm đúng 3 vùng fixture, để kết quả không phụ thuộc dữ liệu thật trong DB dev. */
  const themeFor = async (userId: string) => {
    const [row] = (await db.query(
      `INSERT INTO user_themes (user_id, label, icon, categories, region_ids, expires_at)
       VALUES ($1, 'E2E chủ đề', 'sparkles', '{nature,culture,check_in,cafe,kids}', $2::uuid[], now() + interval '7 days')
       RETURNING id`,
      [userId, regions.map((r) => r.id)],
    )) as Array<{ id: string }>;
    return `user:${row.id}`;
  };

  const rowsOf = async (userId: string, themeKey: string) =>
    (await db.query(
      `SELECT ur.slot, ur.region_id, ur.reason, ur.params, d.place_ids, d.planner
         FROM user_recommendations ur JOIN itinerary_drafts d ON d.id = ur.draft_id
        WHERE ur.user_id = $1 AND ur.window_start = $2 AND ur.theme_key = $3
        ORDER BY ur.slot`,
      [userId, windowStart, themeKey],
    )) as Array<{
      slot: number;
      region_id: string;
      reason: { newPlaceCount: number; revisit: boolean };
      params: { travelParty: string; daysCount: number };
      place_ids: string[];
      planner: string;
    }>;

  it('ghi 3 gợi ý ở 3 vùng khác nhau, bản nháp heuristic, không gọi Gemini', async () => {
    planItinerary.mockClear();
    const userId = await newUser();
    const themeKey = await themeFor(userId);
    expect(await builder.build(userId, windowStart, themeKey)).toBe(3);
    const rows = await rowsOf(userId, themeKey);
    expect(rows.map((r) => r.slot)).toEqual([0, 1, 2]);
    expect(new Set(rows.map((r) => r.region_id))).toEqual(new Set(regions.map((r) => r.id)));
    expect(rows.every((r) => r.planner === 'heuristic')).toBe(true);
    expect(rows[0].params).toMatchObject({ travelParty: 'couple', daysCount: 2 });
    expect(planItinerary).not.toHaveBeenCalled();
  });

  it('hai người cùng thông số dùng chung bản nháp trong kho', async () => {
    const a = await newUser();
    const b = await newUser();
    const keyA = await themeFor(a);
    const keyB = await themeFor(b);
    await builder.build(a, windowStart, keyA);
    await builder.build(b, windowStart, keyB);
    const drafts = async (u: string, k: string) =>
      (
        (await db.query(
          `SELECT draft_id FROM user_recommendations WHERE user_id = $1 AND theme_key = $2 ORDER BY region_id`,
          [u, k],
        )) as Array<{ draft_id: string }>
      ).map((r) => r.draft_id);
    expect(await drafts(b, keyB)).toEqual(await drafts(a, keyA));
  });

  it('nơi đã đi không có trong bản nháp; vùng đã đi xếp sau', async () => {
    const userId = await newUser();
    const themeKey = await themeFor(userId);
    const visited = regions[0].visitIds.slice(0, 2);
    for (const placeId of visited) {
      await db.query(
        `INSERT INTO visited_places (user_id, place_id, region_id, status, visited_at)
         VALUES ($1, $2, $3, 'confirmed', now())`,
        [userId, placeId, regions[0].id],
      );
    }
    await builder.build(userId, windowStart, themeKey);
    const rows = await rowsOf(userId, themeKey);
    for (const row of rows) for (const id of visited) expect(row.place_ids).not.toContain(id);
    const revisited = rows.find((r) => r.region_id === regions[0].id)!;
    expect(revisited.reason.revisit).toBe(true);
    expect(revisited.slot).toBe(2);
  });

  it('build lại cùng khung giờ thay thế, không nhân đôi', async () => {
    const userId = await newUser();
    const themeKey = await themeFor(userId);
    await builder.build(userId, windowStart, themeKey);
    await builder.build(userId, windowStart, themeKey);
    expect(await rowsOf(userId, themeKey)).toHaveLength(3);
  });

  it('ảnh vùng "none" quá 30 ngày được tìm lại, trừ khi bị chặn', async () => {
    const regionId = regions[0].id;
    const [prior] = (await db.query(`SELECT * FROM region_images WHERE region_id = $1`, [regionId])) as Array<
      Record<string, unknown>
    >;
    const queue = app.get(RecommendationsQueue);
    const enqueued = vi.spyOn(queue, 'enqueueMany').mockResolvedValue(undefined);
    const imageJobs = () =>
      enqueued.mock.calls
        .flatMap(([jobs]) => jobs)
        .filter((j) => j.name === 'fetch-region-image' && j.data.regionId === regionId);
    const setImage = (blocked: boolean) =>
      db.query(
        `INSERT INTO region_images (region_id, status, blocked, fetched_at)
         VALUES ($1, 'none', $2, now() - interval '31 days')
         ON CONFLICT (region_id) DO UPDATE SET status = 'none', url = NULL, source = NULL,
           blocked = EXCLUDED.blocked, fetched_at = EXCLUDED.fetched_at`,
        [regionId, blocked],
      );
    try {
      const userId = await newUser();
      const themeKey = await themeFor(userId);
      await setImage(false);
      await builder.build(userId, windowStart, themeKey);
      expect(imageJobs()).toHaveLength(1);

      enqueued.mockClear();
      await setImage(true);
      await builder.build(userId, windowStart, themeKey);
      expect(imageJobs()).toHaveLength(0);
    } finally {
      enqueued.mockRestore();
      await db.query(`DELETE FROM region_images WHERE region_id = $1`, [regionId]);
      if (prior) {
        const cols = Object.keys(prior);
        await db.query(
          `INSERT INTO region_images (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
          cols.map((c) => prior[c]),
        );
      }
    }
  });

  it('chủ đề không tồn tại → UNKNOWN_THEME', async () => {
    const userId = await newUser();
    await expect(builder.build(userId, windowStart, 'fixed:khong-co')).rejects.toMatchObject({
      response: { code: 'UNKNOWN_THEME' },
    });
  });
});
