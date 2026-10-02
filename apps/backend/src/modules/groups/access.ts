import type { GroupRole, InviteRole } from '@rong/shared-types';

/**
 * Quy tắc phân quyền của S8 — nơi duy nhất định nghĩa ai được làm gì. Hàm
 * thuần, không đụng database: `AccessService` đọc vai trò rồi gọi vào đây.
 */
export type ItineraryAction = 'view' | 'edit' | 'delete' | 'move';

export interface ItineraryAccess {
  isCreator: boolean;
  /** Vai trò trong nhóm chứa lịch trình; null khi lịch trình cá nhân hoặc không phải thành viên. */
  groupRole: GroupRole | null;
}

export type AccessDecision = 'allow' | 'forbidden' | 'not_found';

const RANK: Record<GroupRole, number> = { viewer: 1, editor: 2, owner: 3 };

/** Chuyển nhóm (`move`) chỉ người tạo được làm, nên không vai trò nhóm nào có nó. */
const GROUP_ROLE_CAN: Record<GroupRole, ReadonlySet<ItineraryAction>> = {
  owner: new Set(['view', 'edit', 'delete']),
  editor: new Set(['view', 'edit']),
  viewer: new Set(['view']),
};

/** Không xem được thì `not_found` (không lộ lịch trình tồn tại), xem được mà thiếu quyền thì `forbidden`. */
export function decide(
  access: ItineraryAccess,
  action: ItineraryAction,
): AccessDecision {
  if (access.isCreator) return 'allow';
  if (access.groupRole === null) return 'not_found';
  return GROUP_ROLE_CAN[access.groupRole].has(action) ? 'allow' : 'forbidden';
}

export function atLeast(role: GroupRole | null, min: GroupRole): boolean {
  return role !== null && RANK[role] >= RANK[min];
}

/** Vai trò mới sau khi chấp nhận lời mời; null là giữ nguyên. Chỉ nâng, không hạ. */
export function roleAfterAccept(
  current: GroupRole | null,
  offered: InviteRole,
): GroupRole | null {
  if (current === null) return offered;
  return RANK[offered] > RANK[current] ? offered : null;
}
