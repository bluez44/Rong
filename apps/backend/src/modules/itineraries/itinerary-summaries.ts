import type {
  ItinerarySummary,
  ItineraryRole,
  PlannerKind,
} from '@rong/shared-types';
import type { DataSource } from 'typeorm';

/**
 * Danh sách lịch trình kèm quyền của người xem. Dùng chung cho
 * `GET /itineraries` (groupId = null: tôi tạo hoặc thuộc nhóm tôi tham gia) và
 * chi tiết nhóm (chỉ lịch trình của nhóm đó). Là hàm thường, không phải
 * provider, để `GroupsModule` không phải import `ItinerariesModule`.
 */
export async function itinerarySummaries(
  db: DataSource,
  userId: string,
  groupId: string | null,
): Promise<ItinerarySummary[]> {
  const rows = (await db.query(
    `SELECT i.id, i.region_id, r.name AS region_name, i.starts_at, i.ends_at, i.planner,
            jsonb_array_length(i.days) AS day_count, i.created_at,
            i.group_id, g.name AS group_name,
            CASE WHEN i.owner_id = $1 THEN 'creator' ELSE m.role END AS my_role
       FROM itineraries i
       JOIN regions r ON r.id = i.region_id
       LEFT JOIN groups g ON g.id = i.group_id
       LEFT JOIN group_members m ON m.group_id = i.group_id AND m.user_id = $1
      WHERE ${groupId === null ? '(i.owner_id = $1 OR m.user_id IS NOT NULL)' : 'i.group_id = $2'}
      ORDER BY i.created_at DESC
      LIMIT 100`,
    groupId === null ? [userId] : [userId, groupId],
  )) as Array<{
    id: string;
    region_id: string;
    region_name: string;
    starts_at: Date;
    ends_at: Date;
    planner: PlannerKind;
    day_count: number;
    created_at: Date;
    group_id: string | null;
    group_name: string | null;
    my_role: ItineraryRole;
  }>;
  return rows.map((r) => ({
    id: r.id,
    regionId: r.region_id,
    regionName: r.region_name,
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
    planner: r.planner,
    dayCount: Number(r.day_count),
    createdAt: r.created_at.toISOString(),
    groupId: r.group_id,
    groupName: r.group_name,
    myRole: r.my_role,
  }));
}
