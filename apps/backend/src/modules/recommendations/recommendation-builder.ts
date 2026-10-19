import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { ItineraryInput, PlaceCategory } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { VisitsService } from '../visits/visits.service.js';
import type { RecommendationReason } from './copy.js';
import { tripBounds, nextSaturday } from './draft-dates.js';
import { DraftPool, type DraftRow } from './draft-pool.js';
import { RecommendationsQueue } from './queue/recommendations-queue.js';
import { minNewPlaces, pickRegions, type RegionStats } from './scoring.js';
import { ThemeCatalog } from './theme-catalog.js';
import { learnTripParams } from './trip-params.js';

/** Số hạng đầu của danh sách vùng được tính là "nơi nổi bật". */
const TOP_RANKS = 60;
/** Số dòng gợi ý gần nhất (trước khung giờ hiện tại) dùng để hạ điểm vùng lặp. */
const RECENT_ROWS = 9;
const CARDS = 3;

/** Vùng được gợi ý: điểm đến du lịch và tỉnh/thành hiện hành (bỏ bản trước sáp nhập, xã/phường). */
const REGION_KIND = `(r.type = 'destination'
  OR (r.type = 'administrative' AND r.level = 'province' AND r.boundary_version = 'current'))`;

/** Tạo bộ 3 gợi ý cho (người dùng, khung giờ, chủ đề) — spec mục "Tạo bộ gợi ý". */
@Injectable()
export class RecommendationBuilder {
  private readonly logger = new Logger(RecommendationBuilder.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly visits: VisitsService,
    private readonly themes: ThemeCatalog,
    private readonly pool: DraftPool,
    private readonly queue: RecommendationsQueue,
  ) {}

  async interests(userId: string): Promise<PlaceCategory[]> {
    const [row] = (await this.db.query(
      `SELECT interests::text[] AS interests FROM users WHERE id = $1`,
      [userId],
    )) as Array<{ interests: PlaceCategory[] }>;
    return row?.interests ?? [];
  }

  async build(userId: string, windowStart: Date, themeKey: string): Promise<number> {
    await this.visits.inferVisits(userId);
    const interests = await this.interests(userId);
    const theme = await this.themes.resolve(userId, themeKey, interests);
    const visited = await this.visits.visitedPlaceIds(userId);
    const inputs = (
      (await this.db.query(
        `SELECT input FROM itineraries WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [userId],
      )) as Array<{ input: ItineraryInput }>
    ).map((r) => r.input);
    const trip = learnTripParams(inputs);
    const categories =
      theme.kind === 'default'
        ? interests
        : [...new Set([...theme.categories, ...interests])];

    const stats = await this.regionStats(userId, visited, categories, theme.regionIds, windowStart);
    const picked = pickRegions(stats, minNewPlaces(trip), CARDS);

    const startDate = nextSaturday(new Date());
    const startsAt = tripBounds(startDate, trip.daysCount).startsAt;
    const rows: Array<{ region: RegionStats & { score: number }; draft: DraftRow; reason: RecommendationReason }> = [];
    for (const region of picked) {
      let draft: DraftRow;
      try {
        draft = await this.pool.findOrCreate({
          regionId: region.regionId,
          categories,
          trip,
          listVersion: region.listVersion,
          excludePlaceIds: visited,
          userId,
        });
      } catch (error) {
        // FR-6.4: vùng không đủ địa điểm hợp đối tượng thì bỏ qua vùng đó.
        if (error instanceof UnprocessableEntityException) continue;
        throw error;
      }
      rows.push({
        region,
        draft,
        reason: {
          matchedInterests: interests.filter((c) => draftCategories(draft).includes(c)),
          newPlaceCount: region.newPlaces,
          revisit: region.visitedAny,
          savedCount: region.savedNew,
        },
      });
    }

    // Xóa rồi ghi lại (không UPSERT theo slot) vì số thẻ có thể ít đi giữa hai
    // lần build (một vùng hết đủ nơi mới). Hai lần build cùng (user, window,
    // theme) chạy đồng thời sẽ đụng "uq_user_recommendation_slot" (INSERT của
    // lần này xen vào giữa DELETE/INSERT của lần kia); job `build-user-set`
    // tránh được nhờ `jobIdOf` ở tầng hàng đợi (jobs.ts) chống chạy trùng
    // job cùng id, không phải nhờ gì trong hàm này.
    await this.db.transaction(async (m) => {
      await m.query(
        `DELETE FROM user_recommendations WHERE user_id = $1 AND window_start = $2 AND theme_key = $3`,
        [userId, windowStart, themeKey],
      );
      for (const [slot, row] of rows.entries()) {
        await m.query(
          `INSERT INTO user_recommendations
             (user_id, window_start, theme_key, slot, draft_id, region_id, starts_at, params, reason, score)
           VALUES ($1, $2, $3, $4::int, $5, $6, $7, $8::jsonb, $9::jsonb, $10::real)`,
          [
            userId,
            windowStart,
            themeKey,
            slot,
            row.draft.id,
            row.region.regionId,
            startsAt,
            JSON.stringify(trip),
            JSON.stringify(row.reason),
            row.region.score,
          ],
        );
      }
    });

    await this.enqueueMissingImages(rows.map((r) => r.region.regionId));
    this.logger.log(`Gợi ý ${themeKey} cho ${userId}: ${rows.length} thẻ.`);
    return rows.length;
  }

  private async regionStats(
    userId: string,
    visited: string[],
    categories: PlaceCategory[],
    regionIds: string[] | null,
    windowStart: Date,
  ): Promise<RegionStats[]> {
    const rows = (await this.db.query(
      `WITH recent AS (
         SELECT region_id FROM user_recommendations
          WHERE user_id = $1 AND window_start < $5
          ORDER BY created_at DESC LIMIT $6::int
       )
       SELECT r.id, r.name, l.fetched_at AS list_version,
              (SELECT count(*) FROM (
                 SELECT rp.place_id, p.category FROM region_places rp
                   JOIN places p ON p.id = rp.place_id
                  WHERE rp.region_id = r.id
                  ORDER BY rp.rank LIMIT $7::int
               ) top
                WHERE NOT (top.place_id = ANY($2::uuid[]))
                  AND (CASE WHEN cardinality($3::place_category[]) = 0
                            THEN top.category NOT IN ('stay', 'food')
                            ELSE top.category = ANY($3::place_category[]) END)
              )::int AS new_places,
              (SELECT count(*) FROM saved_places s
                WHERE s.user_id = $1 AND s.region_id = r.id
                  AND NOT (s.place_id = ANY($2::uuid[])))::int AS saved_new,
              EXISTS (SELECT 1 FROM region_places rp
                       WHERE rp.region_id = r.id AND rp.place_id = ANY($2::uuid[])) AS visited_any,
              r.id IN (SELECT region_id FROM recent) AS recently_shown
         FROM regions r
         JOIN region_place_lists l ON l.region_id = r.id AND l.status = 'ready' AND l.fetched_at IS NOT NULL
        WHERE ${REGION_KIND}
          AND ($4::uuid[] IS NULL OR r.id = ANY($4::uuid[]))`,
      [userId, visited, categories, regionIds, windowStart, RECENT_ROWS, TOP_RANKS],
    )) as Array<{
      id: string;
      name: string;
      list_version: Date;
      new_places: number;
      saved_new: number;
      visited_any: boolean;
      recently_shown: boolean;
    }>;
    return rows.map((r) => ({
      regionId: r.id,
      regionName: r.name,
      newPlaces: r.new_places,
      savedNew: r.saved_new,
      visitedAny: r.visited_any,
      recentlyShown: r.recently_shown,
      listVersion: r.list_version,
    }));
  }

  private async enqueueMissingImages(regionIds: string[]): Promise<void> {
    if (regionIds.length === 0) return;
    const rows = (await this.db.query(
      `SELECT id FROM unnest($1::uuid[]) AS id
        WHERE NOT EXISTS (SELECT 1 FROM region_images ri WHERE ri.region_id = id)`,
      [regionIds],
    )) as Array<{ id: string }>;
    await this.queue.enqueueMany(
      rows.map((r) => ({ name: 'fetch-region-image' as const, data: { regionId: r.id } })),
    );
  }
}

/** Danh mục điểm tham quan trong bản nháp, nhiều nhất trước. */
export function draftCategories(draft: Pick<DraftRow, 'days'>): PlaceCategory[] {
  const counts = new Map<PlaceCategory, number>();
  for (const item of draft.days.flatMap((d) => d.items)) {
    if (item.kind !== 'visit' || !item.place) continue;
    const c = item.place.category as PlaceCategory;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}
