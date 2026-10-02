import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  CreatedGroupInvite,
  GroupDetail,
  GroupInvite,
  InvitePreview,
  InviteRole,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { roleAfterAccept } from './access.js';
import { AccessService } from './access.service.js';
import { ActivityService } from './activity.service.js';
import { conflict, gone, notFound } from './errors.js';
import {
  GroupsService,
  groupLimit,
  MAX_GROUPS_PER_USER,
  MAX_MEMBERS,
} from './groups.service.js';
import { hashToken, isTokenShape, newToken } from './tokens.js';

export const MAX_ACTIVE_INVITES = 10;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface InviteRow {
  id: string;
  group_id: string;
  role: InviteRole;
  expires_at: Date;
  revoked_at: Date | null;
}

@Injectable()
export class InvitesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly groups: GroupsService,
  ) {}

  async create(
    userId: string,
    groupId: string,
    role: InviteRole,
  ): Promise<CreatedGroupInvite> {
    await this.access.requireGroupRole(userId, groupId, 'owner');
    const [{ n }] = (await this.db.query(
      `SELECT count(*)::int AS n FROM group_invites
        WHERE group_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [groupId],
    )) as Array<{ n: number }>;
    if (n >= MAX_ACTIVE_INVITES) {
      throw conflict(
        'INVITE_LIMIT',
        `Mỗi nhóm có tối đa ${MAX_ACTIVE_INVITES} link mời còn hiệu lực. Thu hồi bớt rồi thử lại.`,
      );
    }
    const token = newToken();
    const [row] = (await this.db.query(
      `INSERT INTO group_invites (group_id, token_hash, role, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, expires_at, created_at`,
      [
        groupId,
        hashToken(token),
        role,
        userId,
        new Date(Date.now() + INVITE_TTL_MS),
      ],
    )) as Array<{ id: string; expires_at: Date; created_at: Date }>;
    return {
      id: row.id,
      role,
      token,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    };
  }

  async listActive(userId: string, groupId: string): Promise<GroupInvite[]> {
    await this.access.requireGroupRole(userId, groupId, 'owner');
    const rows = (await this.db.query(
      `SELECT id, role, expires_at, created_at FROM group_invites
        WHERE group_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC`,
      [groupId],
    )) as Array<{
      id: string;
      role: InviteRole;
      expires_at: Date;
      created_at: Date;
    }>;
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      expiresAt: r.expires_at.toISOString(),
      createdAt: r.created_at.toISOString(),
    }));
  }

  /** FR-10.7. Idempotent. */
  async revoke(
    userId: string,
    groupId: string,
    inviteId: string,
  ): Promise<void> {
    await this.access.requireGroupRole(userId, groupId, 'owner');
    await this.db.query(
      `UPDATE group_invites SET revoked_at = now()
        WHERE id = $1 AND group_id = $2 AND revoked_at IS NULL`,
      [inviteId, groupId],
    );
  }

  async preview(token: string): Promise<InvitePreview> {
    const hash = this.hashOrThrow(token);
    const [row] = (await this.db.query(
      `SELECT i.id, i.group_id, i.role, i.expires_at, i.revoked_at,
              g.name AS group_name, u.display_name AS inviter_name,
              (SELECT count(*)::int FROM group_members m WHERE m.group_id = i.group_id) AS member_count
         FROM group_invites i
         JOIN groups g ON g.id = i.group_id
         LEFT JOIN users u ON u.id = i.created_by
        WHERE i.token_hash = $1`,
      [hash],
    )) as Array<
      InviteRow & {
        group_name: string;
        inviter_name: string | null;
        member_count: number;
      }
    >;
    this.assertUsable(row);
    return {
      groupName: row.group_name,
      inviterName: row.inviter_name,
      role: row.role,
      memberCount: row.member_count,
      expiresAt: row.expires_at.toISOString(),
    };
  }

  /**
   * Tham gia nhóm. Đã là thành viên thì chỉ nâng vai trò, không hạ. Khóa dòng
   * nhóm để hai người cùng vào lúc nhóm còn một chỗ không vượt giới hạn.
   */
  async accept(userId: string, token: string): Promise<GroupDetail> {
    const hash = this.hashOrThrow(token);
    const groupId = await this.db.transaction(async (m) => {
      const [invite] = (await m.query(
        `SELECT id, group_id, role, expires_at, revoked_at FROM group_invites WHERE token_hash = $1`,
        [hash],
      )) as InviteRow[];
      this.assertUsable(invite);
      await m.query(`SELECT id FROM groups WHERE id = $1 FOR UPDATE`, [
        invite.group_id,
      ]);

      const current = await this.access.groupRole(userId, invite.group_id, m);
      const next = roleAfterAccept(current, invite.role);
      if (next === null) return invite.group_id;

      const userName = await this.groups.displayName(userId, m);
      if (current === null) {
        const [{ n }] = (await m.query(
          `SELECT count(*)::int AS n FROM group_members WHERE group_id = $1`,
          [invite.group_id],
        )) as Array<{ n: number }>;
        if (n >= MAX_MEMBERS) {
          throw conflict('GROUP_FULL', `Nhóm đã đủ ${MAX_MEMBERS} thành viên.`);
        }
        if (
          (await this.groups.countGroupsOf(userId, m)) >= MAX_GROUPS_PER_USER
        ) {
          throw groupLimit();
        }
        await m.query(
          `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)`,
          [invite.group_id, userId, next],
        );
        await this.activity.record(
          m,
          invite.group_id,
          userId,
          'member_joined',
          {
            userName,
            role: next,
          },
        );
      } else {
        await m.query(
          `UPDATE group_members SET role = $3 WHERE group_id = $1 AND user_id = $2`,
          [invite.group_id, userId, next],
        );
        await this.activity.record(m, invite.group_id, userId, 'role_changed', {
          userName,
          from: current,
          to: next,
        });
      }
      return invite.group_id;
    });
    return this.groups.detail(userId, groupId);
  }

  private hashOrThrow(token: string): string {
    if (!isTokenShape(token)) throw inviteNotFound();
    return hashToken(token);
  }

  private assertUsable(row: InviteRow | undefined): asserts row is InviteRow {
    if (!row) throw inviteNotFound();
    if (row.revoked_at !== null || row.expires_at.getTime() <= Date.now()) {
      throw gone(
        'INVITE_EXPIRED',
        'Link mời đã hết hạn hoặc bị thu hồi. Xin link mới từ chủ nhóm.',
      );
    }
  }
}

function inviteNotFound() {
  return notFound('INVITE_NOT_FOUND', 'Link mời không hợp lệ.');
}
