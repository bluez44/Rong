import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';
import { RecommendationMaintenance } from '../src/modules/recommendations/maintenance.js';
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

describe('Job theo lịch (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let jobs: RecommendationMaintenance;
  let queue: RecommendationsQueue;
  let builder: RecommendationBuilder;
  let fixture: RecommendationRegionsFixture;
  let regions: FixtureRegion[];
  const planItinerary = vi.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary, suggestThemes: vi.fn().mockResolvedValue({ themes: [] }) })
      .overrideProvider(UnsplashClient)
      .useValue({ enabled: false, searchLandscape: async () => null })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DataSource);
    jobs = app.get(RecommendationMaintenance);
    queue = app.get(RecommendationsQueue);
    builder = app.get(RecommendationBuilder);
    fixture = await seedRecommendationRegions(db, 'maint');
    regions = fixture.regions;
  });

  afterAll(async () => {
    await queue?.idle();
    await db?.query(`DELETE FROM users WHERE display_name LIKE 'e2e-rec-maint%'`);
    await cleanupRecommendationRegions(db, fixture);
    await app?.close();
  });

  const newUser = async (lastSeen: string) => {
    const [u] = (await db.query(
      `INSERT INTO users (display_name, last_seen_at) VALUES ('e2e-rec-maint', now() - $1::interval) RETURNING id`,
      [lastSeen],
    )) as Array<{ id: string }>;
    const [t] = (await db.query(
      `INSERT INTO user_themes (user_id, label, icon, categories, region_ids, expires_at)
       VALUES ($1, 'E2E', 'sparkles', '{nature,culture,check_in,cafe,kids}', $2::uuid[], now() + interval '7 days') RETURNING id`,
      [u.id, regions.map((r) => r.id)],
    )) as Array<{ id: string }>;
    return { id: u.id, theme: `user:${t.id}` };
  };

  it('refresh-window chỉ đẩy job cho người dùng hoạt động trong 14 ngày', async () => {
    const active = await newUser('1 day');
    const idle = await newUser('20 days');
    const spy = vi.spyOn(queue, 'enqueueMany');
    await jobs.refreshWindow();
    const pushed = spy.mock.calls.flatMap(([batch]) => batch);
    spy.mockRestore();
    const users = pushed.map((j) => (j.data as { userId: string }).userId);
    expect(users).toContain(active.id);
    expect(users).not.toContain(idle.id);
    expect(pushed.every((j) => j.name === 'build-user-set')).toBe(true);
    await queue.idle();
  });

  it('upgrade-draft: Gemini thành công → planner ai, giữ loại trừ', async () => {
    const u = await newUser('1 hour');
    const { windowStart } = windowFor(new Date());
    await builder.build(u.id, windowStart, u.theme);
    const [{ draft_id }] = (await db.query(
      `SELECT draft_id FROM user_recommendations WHERE user_id = $1 ORDER BY slot LIMIT 1`,
      [u.id],
    )) as Array<{ draft_id: string }>;

    // Gemini giả: giữ nguyên các điểm được giao, thứ tự như gửi. Dòng cuối của
    // request (`buildPlannerRequest`) là mảng địa điểm (id/required), không có
    // ngày; ngày gán cho từng điểm nằm ở khối JSON ngay trước đó ("Phương án
    // gom theo khu vực"), nên đọc từ đó để biết placeId thuộc ngày nào.
    planItinerary.mockImplementationOnce(async (_s: string, req: string) => {
      const lines = req.split('\n');
      const assignment = JSON.parse(lines.at(-3)!) as Array<{
        dayIndex: number;
        placeIds: string[];
      }>;
      return {
        days: assignment.map((a) => ({
          dayIndex: a.dayIndex,
          stops: a.placeIds.map((id) => ({
            placeId: id,
            visitMinutes: 60,
            reason: 'Đẹp',
            openingHours: '',
          })),
        })),
        tips: ['Mang áo khoác'],
      };
    });
    expect(await jobs.upgradeDraft(draft_id)).toBe(true);
    const [draft] = (await db.query(
      `SELECT planner, upgraded_at, tips FROM itinerary_drafts WHERE id = $1`,
      [draft_id],
    )) as Array<{ planner: string; upgraded_at: Date | null; tips: string[] }>;
    expect(draft.planner).toBe('ai');
    expect(draft.upgraded_at).not.toBeNull();
    // Đã nâng cấp thì không chạy lại.
    expect(await jobs.upgradeDraft(draft_id)).toBe(false);
  });

  it('cleanup xóa gợi ý cũ hơn 30 ngày và chủ đề hết hạn', async () => {
    const u = await newUser('1 hour');
    const { windowStart } = windowFor(new Date());
    await builder.build(u.id, windowStart, u.theme);
    await db.query(
      `UPDATE user_recommendations SET created_at = now() - interval '31 days' WHERE user_id = $1`,
      [u.id],
    );
    await db.query(`UPDATE user_themes SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [u.id]);
    const result = await jobs.cleanup();
    expect(result.recommendations).toBeGreaterThanOrEqual(3);
    expect(result.themes).toBeGreaterThanOrEqual(1);
    const left = (await db.query(`SELECT 1 FROM user_recommendations WHERE user_id = $1`, [u.id])) as unknown[];
    expect(left).toHaveLength(0);
  });
});
