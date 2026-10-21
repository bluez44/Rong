import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  CurrentItineraryShareLink,
  ItineraryDay,
  ItineraryInput,
  ItineraryShareLink,
  ItineraryWarning,
  PlannerKind,
  PublicItinerary,
  UnscheduledPlace,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import type { ShareLinksConfig } from '../../config/configuration.js';
import { notFound } from '../groups/errors.js';
import { hashToken, isTokenShape } from '../groups/tokens.js';
import { withItineraryPlaceData } from './itinerary-place-data.js';
import { ItinerariesService } from './itineraries.service.js';
import { shareLinkToken } from './share-link-token.js';

export const SHARE_LINKS_CONFIG = 'SHARE_LINKS_CONFIG';

/**
 * Link xem lịch trình trên web (FR-10.3). Mỗi lịch trình tối đa một link còn
 * hiệu lực; tạo lại thì link cũ bị thu hồi. Không hết hạn. Token suy ra từ id
 * link (`share-link-token.ts`) nên lấy lại được mà database chỉ lưu bản băm.
 */
@Injectable()
export class ShareLinksService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly itineraries: ItinerariesService,
    @Inject(SHARE_LINKS_CONFIG) private readonly config: ShareLinksConfig,
  ) {}

  async create(
    userId: string,
    itineraryId: string,
  ): Promise<ItineraryShareLink> {
    await this.itineraries.authorize(userId, itineraryId, 'edit');
    const linkId = randomUUID();
    const token = shareLinkToken(this.config.secret, linkId);
    const createdAt = await this.db.transaction(async (m) => {
      await m.query(
        `UPDATE itinerary_share_links SET revoked_at = now()
          WHERE itinerary_id = $1 AND revoked_at IS NULL`,
        [itineraryId],
      );
      const [row] = (await m.query(
        `INSERT INTO itinerary_share_links (id, itinerary_id, token_hash, created_by)
         VALUES ($1, $2, $3, $4) RETURNING created_at`,
        [linkId, itineraryId, hashToken(token), userId],
      )) as Array<{ created_at: Date }>;
      return row.created_at;
    });
    return { token, createdAt: createdAt.toISOString() };
  }

  /** Link đang hiệu lực cho người xem được lịch trình (kể cả viewer): chia sẻ lại không đổi link. */
  async current(
    userId: string,
    itineraryId: string,
  ): Promise<CurrentItineraryShareLink> {
    await this.itineraries.authorize(userId, itineraryId, 'view');
    const [row] = (await this.db.query(
      `SELECT id, token_hash, created_at FROM itinerary_share_links
        WHERE itinerary_id = $1 AND revoked_at IS NULL`,
      [itineraryId],
    )) as Array<{ id: string; token_hash: string; created_at: Date }>;
    if (!row) return { link: null };
    const token = shareLinkToken(this.config.secret, row.id);
    // Link tạo bằng token ngẫu nhiên (trước khi suy ra từ id) hoặc trước khi đổi khóa: không lấy lại được.
    if (hashToken(token) !== row.token_hash) return { link: null };
    return { link: { token, createdAt: row.created_at.toISOString() } };
  }

  /**
   * Lấy link đang hiệu lực, chưa có thì tạo (quyền sửa) — đường chia sẻ của app. Không bao giờ
   * thu hồi link còn lấy lại được: hai người bấm chia sẻ cùng lúc nhận cùng một link.
   */
  async ensure(
    userId: string,
    itineraryId: string,
  ): Promise<ItineraryShareLink> {
    await this.itineraries.authorize(userId, itineraryId, 'edit');
    const linkId = randomUUID();
    await this.db.query(
      `INSERT INTO itinerary_share_links (id, itinerary_id, token_hash, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (itinerary_id) WHERE revoked_at IS NULL DO NOTHING`,
      [
        linkId,
        itineraryId,
        hashToken(shareLinkToken(this.config.secret, linkId)),
        userId,
      ],
    );
    const { link } = await this.current(userId, itineraryId);
    // Link đang hiệu lực là link cũ không lấy lại được token: thay bằng link mới.
    return link ?? this.create(userId, itineraryId);
  }

  async revoke(userId: string, itineraryId: string): Promise<void> {
    await this.itineraries.authorize(userId, itineraryId, 'edit');
    await this.db.query(
      `UPDATE itinerary_share_links SET revoked_at = now()
        WHERE itinerary_id = $1 AND revoked_at IS NULL`,
      [itineraryId],
    );
  }

  /**
   * Chỉ dữ liệu riêng của app và ghi chú địa điểm của người tạo (spec 2026-10-21-user-pinned-places §4); không id
   * người dùng, ghi chú chuyến đi, nhóm hay nội dung Google.
   */
  async getPublic(token: string): Promise<PublicItinerary> {
    if (!isTokenShape(token)) throw shareLinkNotFound();
    const [row] = (await this.db.query(
      `SELECT i.owner_id, i.input, i.planner, i.starts_at, i.ends_at, i.days, i.unscheduled,
              i.warnings, i.tips, i.updated_at, r.name AS region_name, pr.name AS parent_name
         FROM itinerary_share_links s
         JOIN itineraries i ON i.id = s.itinerary_id
         JOIN regions r ON r.id = i.region_id
         LEFT JOIN regions pr ON pr.id = r.parent_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
      [hashToken(token)],
    )) as Array<{
      owner_id: string;
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
      days: await withItineraryPlaceData(this.db, row.days, row.owner_id),
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
