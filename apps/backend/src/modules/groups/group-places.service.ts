import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { GroupPlace, PlaceCategory } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { AccessService } from './access.service.js';
import { ActivityService } from './activity.service.js';
import { bad, conflict, notFound } from './errors.js';

export const MAX_GROUP_PLACES = 200;

/** Danh sách địa điểm chung của nhóm — FR-10.9. Viewer chỉ xem. */
@Injectable()
export class GroupPlacesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
  ) {}

  async list(userId: string, groupId: string): Promise<GroupPlace[]> {
    await this.access.requireGroupRole(userId, groupId, 'viewer');
    const rows = (await this.db.query(
      `SELECT gp.place_id, p.name, p.category, gp.region_id, r.name AS region_name,
              pr.name AS parent_name, u.display_name AS added_by_name, gp.created_at
         FROM group_places gp
         JOIN places p ON p.id = gp.place_id
         JOIN regions r ON r.id = gp.region_id
         LEFT JOIN regions pr ON pr.id = r.parent_id
         LEFT JOIN users u ON u.id = gp.added_by
        WHERE gp.group_id = $1
        ORDER BY gp.created_at DESC`,
      [groupId],
    )) as Array<{
      place_id: string;
      name: string;
      category: PlaceCategory;
      region_id: string;
      region_name: string;
      parent_name: string | null;
      added_by_name: string | null;
      created_at: Date;
    }>;
    return rows.map((r) => ({
      placeId: r.place_id,
      name: r.name,
      category: r.category,
      regionId: r.region_id,
      regionName: r.parent_name
        ? `${r.region_name}, ${r.parent_name}`
        : r.region_name,
      addedByName: r.added_by_name,
      addedAt: r.created_at.toISOString(),
    }));
  }

  /** Đã có thì giữ nguyên (không đổi vùng, không ghi nhật ký). */
  async add(
    userId: string,
    groupId: string,
    placeId: string,
    regionId: string,
  ): Promise<void> {
    await this.access.requireGroupRole(userId, groupId, 'editor');
    const [check] = (await this.db.query(
      `SELECT (SELECT name FROM places WHERE id = $1) AS place_name,
              EXISTS (SELECT 1 FROM regions WHERE id = $2) AS region,
              (SELECT count(*)::int FROM group_places WHERE group_id = $3) AS n,
              EXISTS (SELECT 1 FROM group_places WHERE group_id = $3 AND place_id = $1) AS already`,
      [placeId, regionId, groupId],
    )) as Array<{
      place_name: string | null;
      region: boolean;
      n: number;
      already: boolean;
    }>;
    if (check.place_name === null) {
      throw notFound('PLACE_NOT_FOUND', 'Không tìm thấy địa điểm này.');
    }
    if (!check.region) throw bad('UNKNOWN_REGION', 'Không tìm thấy vùng này.');
    if (check.already) return;
    if (check.n >= MAX_GROUP_PLACES) {
      throw conflict(
        'GROUP_PLACES_LIMIT',
        `Danh sách chung tối đa ${MAX_GROUP_PLACES} địa điểm. Bỏ bớt rồi thử lại.`,
      );
    }
    await this.db.transaction(async (m) => {
      const inserted = (await m.query(
        `INSERT INTO group_places (group_id, place_id, region_id, added_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (group_id, place_id) DO NOTHING
         RETURNING place_id`,
        [groupId, placeId, regionId, userId],
      )) as unknown[];
      if (inserted.length === 0) return;
      await this.activity.record(m, groupId, userId, 'place_added', {
        placeId,
        placeName: check.place_name,
      });
    });
  }

  async remove(
    userId: string,
    groupId: string,
    placeId: string,
  ): Promise<void> {
    await this.access.requireGroupRole(userId, groupId, 'editor');
    await this.db.transaction(async (m) => {
      // TypeORM trả DELETE/UPDATE dạng [rows, rowCount], khác INSERT/SELECT.
      const [rows] = (await m.query(
        `DELETE FROM group_places gp USING places p
          WHERE gp.group_id = $1 AND gp.place_id = $2 AND p.id = gp.place_id
          RETURNING p.name`,
        [groupId, placeId],
      )) as [Array<{ name: string }>, number];
      const row = rows[0];
      if (!row) return;
      await this.activity.record(m, groupId, userId, 'place_removed', {
        placeId,
        placeName: row.name,
      });
    });
  }
}
