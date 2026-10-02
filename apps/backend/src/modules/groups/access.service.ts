import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { GroupRole } from '@rong/shared-types';
import { DataSource, type EntityManager } from 'typeorm';

import { atLeast, type ItineraryAccess } from './access.js';
import { forbiddenRole, groupNotFound } from './errors.js';

/** Đọc vai trò từ database. Quy tắc nằm ở `access.ts`. */
@Injectable()
export class AccessService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async groupRole(
    userId: string,
    groupId: string,
    manager: EntityManager = this.db.manager,
  ): Promise<GroupRole | null> {
    const [row] = (await manager.query(
      `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId],
    )) as Array<{ role: GroupRole }>;
    return row?.role ?? null;
  }

  /** Không là thành viên → 404 (không lộ nhóm tồn tại); vai trò thấp hơn `min` → 403. */
  async requireGroupRole(
    userId: string,
    groupId: string,
    min: GroupRole,
    manager?: EntityManager,
  ): Promise<GroupRole> {
    const role = await this.groupRole(userId, groupId, manager);
    if (role === null) throw groupNotFound();
    if (!atLeast(role, min)) throw forbiddenRole();
    return role;
  }

  /** null khi lịch trình không tồn tại. */
  async itineraryAccess(
    userId: string,
    itineraryId: string,
  ): Promise<ItineraryAccess | null> {
    const [row] = (await this.db.query(
      `SELECT i.owner_id = $2 AS is_creator, m.role
         FROM itineraries i
         LEFT JOIN group_members m ON m.group_id = i.group_id AND m.user_id = $2
        WHERE i.id = $1`,
      [itineraryId, userId],
    )) as Array<{ is_creator: boolean; role: GroupRole | null }>;
    if (!row) return null;
    return { isCreator: row.is_creator, groupRole: row.role ?? null };
  }
}
