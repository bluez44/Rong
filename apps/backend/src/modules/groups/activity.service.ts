import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  CursorPage,
  GroupActivity,
  GroupActivityType,
} from '@rong/shared-types';
import { DataSource, type EntityManager } from 'typeorm';

import {
  decodeActivityCursor,
  encodeActivityCursor,
  shouldMerge,
} from './activity.js';

const PAGE_SIZE = 20;

interface ActivityRow {
  id: string;
  type: GroupActivityType;
  actor_id: string | null;
  actor_name: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  t: string;
}

@Injectable()
export class ActivityService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Gọi trong cùng transaction với thao tác gây ra hoạt động (spec S8 mục 5). */
  async record(
    manager: EntityManager,
    groupId: string,
    actorId: string,
    type: GroupActivityType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (type === 'itinerary_updated') {
      const [last] = (await manager.query(
        `SELECT id, type, actor_id, payload->>'itineraryId' AS itinerary_id, created_at
           FROM group_activities
          WHERE group_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [groupId],
      )) as Array<{
        id: string;
        type: string;
        actor_id: string | null;
        itinerary_id: string | null;
        created_at: Date;
      }>;
      const merge = shouldMerge(
        last && {
          type: last.type,
          actorId: last.actor_id,
          itineraryId: last.itinerary_id,
          createdAt: last.created_at,
        },
        {
          type,
          actorId,
          itineraryId: (payload.itineraryId as string | undefined) ?? null,
        },
        new Date(),
      );
      if (merge) {
        await manager.query(
          `UPDATE group_activities SET created_at = now(), payload = $2 WHERE id = $1`,
          [last.id, payload],
        );
        return;
      }
    }
    await manager.query(
      `INSERT INTO group_activities (group_id, actor_id, type, payload) VALUES ($1, $2, $3, $4)`,
      [groupId, actorId, type, payload],
    );
  }

  /** Mới nhất trước. Gọi sau khi đã kiểm tra quyền xem nhóm. */
  async list(
    groupId: string,
    rawCursor: string | undefined,
  ): Promise<CursorPage<GroupActivity>> {
    const cursor = decodeActivityCursor(rawCursor);
    const rows = (await this.db.query(
      `SELECT a.id, a.type, a.actor_id, u.display_name AS actor_name, a.payload,
              a.created_at, a.created_at::text AS t
         FROM group_activities a
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.group_id = $1
          AND ($2::timestamptz IS NULL OR (a.created_at, a.id) < ($2::timestamptz, $3::uuid))
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $4`,
      [groupId, cursor?.t ?? null, cursor?.id ?? null, PAGE_SIZE + 1],
    )) as ActivityRow[];
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        id: r.id,
        type: r.type,
        actorId: r.actor_id,
        actorName: r.actor_name,
        payload: r.payload,
        createdAt: r.created_at.toISOString(),
      })),
      nextCursor:
        rows.length > PAGE_SIZE && last
          ? encodeActivityCursor({ t: last.t, id: last.id })
          : null,
    };
  }
}
