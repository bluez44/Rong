import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  ItineraryDay,
  PendingVisitPlace,
  PendingVisitReview,
  PlaceCategory,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { decide } from '../groups/access.js';
import { AccessService } from '../groups/access.service.js';
import { itineraryNotFound } from '../groups/errors.js';
import { jobIdOf } from '../recommendations/queue/jobs.js';
import { RecommendationsQueue } from '../recommendations/queue/recommendations-queue.js';
import { windowFor } from '../recommendations/window.js';

/** Chỉ hỏi lại các chuyến kết thúc trong chừng này ngày. */
const PENDING_WINDOW_DAYS = 60;
const PENDING_LIMIT = 5;

/** Lịch trình tôi tạo hoặc thuộc nhóm tôi tham gia; `$1` là user id. */
const MY_ITINERARY = `(i.owner_id = $1 OR EXISTS (
  SELECT 1 FROM group_members m WHERE m.group_id = i.group_id AND m.user_id = $1))`;

/**
 * Nơi người dùng đã đi (spec 2026-10-19-home-recommendations): suy ra từ lịch
 * trình đã kết thúc, người dùng sửa lại sau chuyến đi. Bộ gợi ý bỏ những nơi này.
 */
@Injectable()
export class VisitsService {
  private readonly logger = new Logger(VisitsService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly access: AccessService,
    // Module toàn cục (RecommendationsQueueModule): không import RecommendationsModule, tránh vòng.
    private readonly queue: RecommendationsQueue,
  ) {}

  /** Thêm `inferred` cho mọi địa điểm của lịch trình đã kết thúc; dòng đã có (kể cả `rejected`) giữ nguyên. */
  async inferVisits(userId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO visited_places (user_id, place_id, region_id, status, itinerary_id, visited_at)
       SELECT DISTINCT ON (x.place_id) $1::uuid, x.place_id, i.region_id, 'inferred', i.id, i.ends_at
         FROM itineraries i
         CROSS JOIN LATERAL (
           SELECT (item->>'placeId')::uuid AS place_id
             FROM jsonb_array_elements(i.days) d,
                  jsonb_array_elements(d->'items') item
            WHERE item->>'placeId' IS NOT NULL
         ) x
         JOIN places p ON p.id = x.place_id
        WHERE i.ends_at < now() AND ${MY_ITINERARY}
        ORDER BY x.place_id, i.ends_at DESC
       ON CONFLICT (user_id, place_id) DO NOTHING`,
      [userId],
    );
  }

  async visitedPlaceIds(userId: string): Promise<string[]> {
    const rows = (await this.db.query(
      `SELECT place_id FROM visited_places
        WHERE user_id = $1 AND status IN ('inferred', 'confirmed')`,
      [userId],
    )) as Array<{ place_id: string }>;
    return rows.map((r) => r.place_id);
  }

  async pending(userId: string): Promise<PendingVisitReview[]> {
    const rows = (await this.db.query(
      `SELECT i.id, i.ends_at, r.name AS region_name, i.days
         FROM itineraries i
         JOIN regions r ON r.id = i.region_id
        WHERE i.ends_at < now()
          AND i.ends_at > now() - $2::int * interval '1 day'
          AND i.visit_reviewed_at IS NULL
          AND jsonb_path_exists(i.days, '$[*].items[*].placeId ? (@ != null)')
          AND ${MY_ITINERARY}
        ORDER BY i.ends_at DESC
        LIMIT $3`,
      [userId, PENDING_WINDOW_DAYS, PENDING_LIMIT],
    )) as Array<{
      id: string;
      ends_at: Date;
      region_name: string;
      days: ItineraryDay[];
    }>;
    return rows
      .map((r) => ({
        itineraryId: r.id,
        regionName: r.region_name,
        endsAt: r.ends_at.toISOString(),
        places: placesOf(r.days),
      }))
      .filter((r) => r.places.length > 0);
  }

  async review(
    userId: string,
    itineraryId: string,
    visitedPlaceIds: string[],
  ): Promise<void> {
    const access = await this.access.itineraryAccess(userId, itineraryId);
    if (!access || decide(access, 'view') !== 'allow') {
      throw itineraryNotFound();
    }
    const [row] = (await this.db.query(
      `SELECT region_id, days FROM itineraries WHERE id = $1`,
      [itineraryId],
    )) as Array<{ region_id: string; days: ItineraryDay[] }>;
    if (!row) throw itineraryNotFound();

    const all = placesOf(row.days).map((p) => p.placeId);
    const visited = new Set(visitedPlaceIds);
    if ([...visited].some((id) => !all.includes(id))) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_PLACES',
        message: 'Có địa điểm không thuộc lịch trình này.',
      });
    }

    await this.db.transaction(async (m) => {
      if (all.length > 0) {
        await m.query(
          `INSERT INTO visited_places (user_id, place_id, region_id, status, itinerary_id, visited_at)
           SELECT $1::uuid, p.id, $2::uuid,
                  CASE WHEN p.id = ANY($4::uuid[]) THEN 'confirmed' ELSE 'rejected' END,
                  $5::uuid, now()
             FROM places p
            WHERE p.id = ANY($3::uuid[])
           ON CONFLICT (user_id, place_id) DO UPDATE
             SET status = EXCLUDED.status,
                 itinerary_id = EXCLUDED.itinerary_id,
                 visited_at = EXCLUDED.visited_at`,
          [userId, row.region_id, all, [...visited], itineraryId],
        );
      }
      await m.query(
        `UPDATE itineraries SET visit_reviewed_at = now() WHERE id = $1`,
        [itineraryId],
      );
    });
    await this.invalidateRecommendations(userId);
  }

  /**
   * Thẻ gợi ý của khung giờ hiện tại được dựng trước khi người dùng xác nhận nơi đã đi:
   * xóa thẻ chưa lưu (mọi chủ đề) và job dựng của chúng để lần mở trang chủ sau dựng lại.
   */
  private async invalidateRecommendations(userId: string): Promise<void> {
    const { windowStart } = windowFor(new Date());
    // TypeORM trả DELETE ... RETURNING dạng [rows, rowCount].
    const [rows] = (await this.db.query(
      `DELETE FROM user_recommendations
        WHERE user_id = $1 AND window_start = $2 AND saved_itinerary_id IS NULL
        RETURNING theme_key`,
      [userId, windowStart],
    )) as [Array<{ theme_key: string }>, number];
    for (const themeKey of new Set(rows.map((r) => r.theme_key))) {
      const jobId = jobIdOf({
        name: 'build-user-set',
        data: { userId, windowStart: windowStart.toISOString(), themeKey },
      })!;
      try {
        await this.queue.remove(jobId);
      } catch (error) {
        this.logger.error(`Không xóa được job gợi ý ${jobId}: ${(error as Error).message}`);
      }
    }
  }
}

/** Địa điểm (tham quan, bữa ăn) trong lịch trình, không trùng, theo thứ tự xuất hiện. */
function placesOf(days: ItineraryDay[]): PendingVisitPlace[] {
  const seen = new Map<string, PendingVisitPlace>();
  for (const item of days.flatMap((d) => d.items)) {
    if (!item.placeId || !item.place || seen.has(item.placeId)) continue;
    seen.set(item.placeId, {
      placeId: item.placeId,
      name: item.place.name,
      category: item.place.category as PlaceCategory,
    });
  }
  return [...seen.values()];
}
