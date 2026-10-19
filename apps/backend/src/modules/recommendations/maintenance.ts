import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ItineraryPlanner } from '../itineraries/itinerary-planner.js';
import { WebPlacesService } from '../places/web-places.service.js';
import { DraftPool, placeIdsOf } from './draft-pool.js';
import { RecommendationsQueue } from './queue/recommendations-queue.js';
import { FEATURED_REGION_SOURCE_KEYS } from './themes.js';
import { windowFor } from './window.js';

const ACTIVE_DAYS = 14;
const BATCH = 500;
const KEEP_RECOMMENDATIONS_DAYS = 30;

/** Các job theo lịch (spec mục "Các job") và nâng cấp bản nháp bằng Gemini. */
@Injectable()
export class RecommendationMaintenance {
  private readonly logger = new Logger(RecommendationMaintenance.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly queue: RecommendationsQueue,
    private readonly pool: DraftPool,
    private readonly planner: ItineraryPlanner,
    private readonly webPlaces: WebPlacesService,
  ) {}

  /** 6:00 và 15:00: đẩy `build-user-set` (chủ đề mặc định, ưu tiên thấp) cho người dùng hoạt động. */
  async refreshWindow(now = new Date()): Promise<number> {
    const { windowStart } = windowFor(now);
    const users = await this.activeUsers();
    for (let i = 0; i < users.length; i += BATCH) {
      await this.queue.enqueueMany(
        users.slice(i, i + BATCH).map((userId) => ({
          name: 'build-user-set' as const,
          data: { userId, windowStart: windowStart.toISOString(), themeKey: 'default' },
        })),
        { priority: 10 },
      );
    }
    this.logger.log(`Làm mới gợi ý: ${users.length} người dùng.`);
    return users.length;
  }

  /** Thứ Hai 3:00: sinh lại chủ đề riêng cho người dùng hoạt động. */
  async refreshThemes(): Promise<number> {
    const users = await this.activeUsers();
    for (let i = 0; i < users.length; i += BATCH) {
      await this.queue.enqueueMany(
        users.slice(i, i + BATCH).map((userId) => ({
          name: 'generate-user-themes' as const,
          data: { userId },
        })),
        { priority: 10 },
      );
    }
    return users.length;
  }

  /** 2:00: vùng nổi bật chưa có danh sách hoặc quá hạn thì tạo, lần lượt từng vùng. */
  async warmFeaturedRegions(): Promise<number> {
    const rows = (await this.db.query(
      `SELECT r.id, r.name FROM regions r
         LEFT JOIN region_place_lists l ON l.region_id = r.id
        WHERE r.source_key = ANY($1::text[])
          AND (l.region_id IS NULL OR l.status <> 'ready' OR l.expires_at <= now())`,
      [FEATURED_REGION_SOURCE_KEYS],
    )) as Array<{ id: string; name: string }>;
    for (const region of rows) {
      try {
        await this.webPlaces.listForRegion(region.id, undefined);
      } catch (error) {
        this.logger.warn(`Không tạo được danh sách ${region.name}: ${(error as Error).message}`);
      }
    }
    return rows.length;
  }

  /** 4:30: dọn gợi ý cũ, bản nháp hết phiên bản không còn ai trỏ tới, chủ đề hết hạn. */
  async cleanup(): Promise<{ recommendations: number; drafts: number; themes: number }> {
    // TypeORM trả DELETE/UPDATE dạng [rows, rowCount], khác INSERT/SELECT.
    const [recs] = (await this.db.query(
      `DELETE FROM user_recommendations WHERE created_at < now() - $1::int * interval '1 day' RETURNING id`,
      [KEEP_RECOMMENDATIONS_DAYS],
    )) as [unknown[], number];
    const [drafts] = (await this.db.query(
      `DELETE FROM itinerary_drafts d
        USING region_place_lists l
        WHERE l.region_id = d.region_id
          AND l.fetched_at IS NOT NULL AND d.list_version < l.fetched_at
          AND NOT EXISTS (SELECT 1 FROM user_recommendations ur WHERE ur.draft_id = d.id)
        RETURNING d.id`,
    )) as [unknown[], number];
    const [themes] = (await this.db.query(
      `DELETE FROM user_themes WHERE expires_at < now() RETURNING id`,
    )) as [unknown[], number];
    return { recommendations: recs.length, drafts: drafts.length, themes: themes.length };
  }

  /** Xếp lại bằng Gemini; false khi không cần (đã là `ai`) hoặc bản nháp không còn. Gemini lỗi thì ném để BullMQ thử lại. */
  async upgradeDraft(draftId: string): Promise<boolean> {
    const draft = await this.pool.get(draftId);
    if (!draft || draft.planner === 'ai' || draft.upgradedAt) return false;
    const plan = await this.planner.planTrip(draft.input, {
      excludePlaceIds: draft.excludePlaceIds,
    });
    if (plan.planner !== 'ai') throw new Error('Gemini không xếp được bản nháp');
    await this.db.query(
      `UPDATE itinerary_drafts
          SET days = $2::jsonb, unscheduled = $3::jsonb, warnings = $4::jsonb, tips = $5::jsonb,
              place_ids = $6::uuid[], planner = 'ai', upgraded_at = now()
        WHERE id = $1`,
      [
        draftId,
        JSON.stringify(plan.days),
        JSON.stringify(plan.unscheduled),
        JSON.stringify(plan.warnings),
        JSON.stringify(plan.tips),
        placeIdsOf(plan.days),
      ],
    );
    return true;
  }

  private async activeUsers(): Promise<string[]> {
    const rows = (await this.db.query(
      `SELECT id FROM users WHERE is_guest = false AND last_seen_at > now() - $1::int * interval '1 day'`,
      [ACTIVE_DAYS],
    )) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }
}
