import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  ItineraryDay,
  ItineraryInput,
  ItineraryShareLink,
  ItineraryWarning,
  PlannerKind,
  PublicItinerary,
  UnscheduledPlace,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { notFound } from '../groups/errors.js';
import { hashToken, isTokenShape, newToken } from '../groups/tokens.js';
import { ItinerariesService } from './itineraries.service.js';

/**
 * Link xem lịch trình trên web (FR-10.3). Mỗi lịch trình tối đa một link còn
 * hiệu lực; tạo lại thì link cũ bị thu hồi. Không hết hạn.
 */
@Injectable()
export class ShareLinksService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly itineraries: ItinerariesService,
  ) {}

  async create(
    userId: string,
    itineraryId: string,
  ): Promise<ItineraryShareLink> {
    await this.itineraries.authorize(userId, itineraryId, 'edit');
    const token = newToken();
    const createdAt = await this.db.transaction(async (m) => {
      await m.query(
        `UPDATE itinerary_share_links SET revoked_at = now()
          WHERE itinerary_id = $1 AND revoked_at IS NULL`,
        [itineraryId],
      );
      const [row] = (await m.query(
        `INSERT INTO itinerary_share_links (itinerary_id, token_hash, created_by)
         VALUES ($1, $2, $3) RETURNING created_at`,
        [itineraryId, hashToken(token), userId],
      )) as Array<{ created_at: Date }>;
      return row.created_at;
    });
    return { token, createdAt: createdAt.toISOString() };
  }

  async revoke(userId: string, itineraryId: string): Promise<void> {
    await this.itineraries.authorize(userId, itineraryId, 'edit');
    await this.db.query(
      `UPDATE itinerary_share_links SET revoked_at = now()
        WHERE itinerary_id = $1 AND revoked_at IS NULL`,
      [itineraryId],
    );
  }

  /** Chỉ dữ liệu riêng của app; không id người dùng, ghi chú, nhóm hay nội dung Google. */
  async getPublic(token: string): Promise<PublicItinerary> {
    if (!isTokenShape(token)) throw shareLinkNotFound();
    const [row] = (await this.db.query(
      `SELECT i.input, i.planner, i.starts_at, i.ends_at, i.days, i.unscheduled,
              i.warnings, i.tips, i.updated_at, r.name AS region_name, pr.name AS parent_name
         FROM itinerary_share_links s
         JOIN itineraries i ON i.id = s.itinerary_id
         JOIN regions r ON r.id = i.region_id
         LEFT JOIN regions pr ON pr.id = r.parent_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
      [hashToken(token)],
    )) as Array<{
      input: ItineraryInput;
      planner: PlannerKind;
      starts_at: Date;
      ends_at: Date;
      days: ItineraryDay[];
      unscheduled: UnscheduledPlace[];
      warnings: ItineraryWarning[];
      tips: string[];
      updated_at: Date;
      region_name: string;
      parent_name: string | null;
    }>;
    if (!row) throw shareLinkNotFound();
    return {
      regionName: row.parent_name
        ? `${row.region_name}, ${row.parent_name}`
        : row.region_name,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      travelParty: row.input.travelParty,
      adults: row.input.adults,
      children: row.input.children,
      planner: row.planner,
      days: row.days,
      unscheduled: row.unscheduled,
      warnings: row.warnings,
      tips: row.tips,
      updatedAt: row.updated_at.toISOString(),
    };
  }
}

function shareLinkNotFound() {
  return notFound(
    'SHARE_LINK_NOT_FOUND',
    'Link xem lịch trình không tồn tại hoặc đã bị thu hồi.',
  );
}
