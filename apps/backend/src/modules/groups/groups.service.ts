import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  CursorPage,
  GroupActivity,
  GroupDetail,
  GroupMember,
  GroupRole,
  GroupSummary,
  InviteRole,
} from '@rong/shared-types';
import { DataSource, type EntityManager } from 'typeorm';

import { itinerarySummaries } from '../itineraries/itinerary-summaries.js';
import { AccessService } from './access.service.js';
import { ActivityService } from './activity.service.js';
import { bad, conflict, forbiddenRole, notFound } from './errors.js';

/** Giới hạn chống lạm dụng — spec S8 mục 4.7. */
export const MAX_GROUPS_PER_USER = 20;
export const MAX_MEMBERS = 50;

@Injectable()
export class GroupsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly access: AccessService,
    private readonly activityLog: ActivityService,
  ) {}

  async create(userId: string, name: string): Promise<GroupDetail> {
    const groupId = await this.db.transaction(async (m) => {
      if ((await this.countGroupsOf(userId, m)) >= MAX_GROUPS_PER_USER) {
        throw groupLimit();
      }
      const [{ id }] = (await m.query(
        `INSERT INTO groups (name, owner_id) VALUES ($1, $2) RETURNING id`,
        [name, userId],
      )) as Array<{ id: string }>;
      await m.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [id, userId],
      );
      return id;
    });
    return this.detail(userId, groupId);
  }

  async list(userId: string): Promise<GroupSummary[]> {
    const rows = (await this.db.query(
      `SELECT g.id, g.name, m.role, g.created_at,
              (SELECT count(*)::int FROM group_members x WHERE x.group_id = g.id) AS member_count,
              (SELECT count(*)::int FROM itineraries i WHERE i.group_id = g.id) AS itinerary_count
         FROM group_members m
         JOIN groups g ON g.id = m.group_id
        WHERE m.user_id = $1
        ORDER BY g.created_at DESC`,
      [userId],
    )) as Array<{
      id: string;
      name: string;
      role: GroupRole;
      created_at: Date;
      member_count: number;
      itinerary_count: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      myRole: r.role,
      memberCount: r.member_count,
      itineraryCount: r.itinerary_count,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async detail(userId: string, groupId: string): Promise<GroupDetail> {
    const myRole = await this.access.requireGroupRole(
      userId,
      groupId,
      'viewer',
    );
    const [group] = (await this.db.query(
      `SELECT id, name, owner_id, created_at FROM groups WHERE id = $1`,
      [groupId],
    )) as Array<{
      id: string;
      name: string;
      owner_id: string;
      created_at: Date;
    }>;
    const members = (await this.db.query(
      `SELECT m.user_id, u.display_name, m.role, m.joined_at
         FROM group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, m.joined_at`,
      [groupId],
    )) as Array<{
      user_id: string;
      display_name: string | null;
      role: GroupRole;
      joined_at: Date;
    }>;
    return {
      id: group.id,
      name: group.name,
      ownerId: group.owner_id,
      myRole,
      createdAt: group.created_at.toISOString(),
      members: members.map((r): GroupMember => ({
        userId: r.user_id,
        displayName: r.display_name,
        role: r.role,
        joinedAt: r.joined_at.toISOString(),
      })),
      itineraries: await itinerarySummaries(this.db, userId, groupId),
    };
  }

  async rename(
    userId: string,
    groupId: string,
    name: string,
  ): Promise<GroupDetail> {
    await this.access.requireGroupRole(userId, groupId, 'owner');
    await this.db.transaction(async (m) => {
      const [{ name: from }] = (await m.query(
        `SELECT name FROM groups WHERE id = $1 FOR UPDATE`,
        [groupId],
      )) as Array<{ name: string }>;
      if (from === name) return;
      await m.query(
        `UPDATE groups SET name = $2, updated_at = now() WHERE id = $1`,
        [groupId, name],
      );
      await this.activityLog.record(m, groupId, userId, 'group_renamed', {
        from,
        to: name,
      });
    });
    return this.detail(userId, groupId);
  }

  /** Lịch trình trong nhóm trở thành lịch trình cá nhân (khóa ngoại SET NULL). */
  async remove(userId: string, groupId: string): Promise<void> {
    await this.access.requireGroupRole(userId, groupId, 'owner');
    await this.db.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
  }

  async changeRole(
    actorId: string,
    groupId: string,
    targetUserId: string,
    role: InviteRole,
  ): Promise<GroupDetail> {
    await this.access.requireGroupRole(actorId, groupId, 'owner');
    await this.db.transaction(async (m) => {
      const target = await this.member(m, groupId, targetUserId);
      if (target.role === 'owner') {
        throw bad(
          'CANNOT_CHANGE_OWNER',
          'Không đổi được vai trò của chủ nhóm.',
        );
      }
      if (target.role === role) return;
      await m.query(
        `UPDATE group_members SET role = $3 WHERE group_id = $1 AND user_id = $2`,
        [groupId, targetUserId, role],
      );
      await this.activityLog.record(m, groupId, actorId, 'role_changed', {
        userName: target.display_name,
        from: target.role,
        to: role,
      });
    });
    return this.detail(actorId, groupId);
  }

  /** Owner xóa thành viên, hoặc thành viên tự rời. Owner không tự rời được — muốn rời thì xóa nhóm. */
  async removeMember(
    actorId: string,
    groupId: string,
    targetUserId: string,
  ): Promise<void> {
    const actorRole = await this.access.requireGroupRole(
      actorId,
      groupId,
      'viewer',
    );
    const self = actorId === targetUserId;
    if (!self && actorRole !== 'owner') throw forbiddenRole();
    await this.db.transaction(async (m) => {
      const target = await this.member(m, groupId, targetUserId);
      if (target.role === 'owner') {
        throw bad(
          'OWNER_CANNOT_LEAVE',
          'Chủ nhóm không rời nhóm được. Xóa nhóm nếu không dùng nữa.',
        );
      }
      await m.query(
        `DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`,
        [groupId, targetUserId],
      );
      await this.activityLog.record(
        m,
        groupId,
        actorId,
        self ? 'member_left' : 'member_removed',
        { userName: target.display_name },
      );
    });
  }

  async activity(
    userId: string,
    groupId: string,
    cursor: string | undefined,
  ): Promise<CursorPage<GroupActivity>> {
    await this.access.requireGroupRole(userId, groupId, 'viewer');
    return this.activityLog.list(groupId, cursor);
  }

  /** Số nhóm người dùng đang tham gia, kể cả nhóm mình làm owner. */
  async countGroupsOf(userId: string, m: EntityManager): Promise<number> {
    const [{ n }] = (await m.query(
      `SELECT count(*)::int AS n FROM group_members WHERE user_id = $1`,
      [userId],
    )) as Array<{ n: number }>;
    return n;
  }

  async displayName(userId: string, m: EntityManager): Promise<string | null> {
    const [row] = (await m.query(
      `SELECT display_name FROM users WHERE id = $1`,
      [userId],
    )) as Array<{ display_name: string | null }>;
    return row?.display_name ?? null;
  }

  private async member(
    m: EntityManager,
    groupId: string,
    userId: string,
  ): Promise<{ role: GroupRole; display_name: string | null }> {
    const [row] = (await m.query(
      `SELECT m.role, u.display_name
         FROM group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1 AND m.user_id = $2
        FOR UPDATE OF m`,
      [groupId, userId],
    )) as Array<{ role: GroupRole; display_name: string | null }>;
    if (!row)
      throw notFound('MEMBER_NOT_FOUND', 'Người này không ở trong nhóm.');
    return row;
  }
}

export function groupLimit() {
  return conflict(
    'GROUP_LIMIT',
    `Bạn đã tham gia tối đa ${MAX_GROUPS_PER_USER} nhóm. Rời bớt nhóm rồi thử lại.`,
  );
}
