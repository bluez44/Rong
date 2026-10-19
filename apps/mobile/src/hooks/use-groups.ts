import type { GroupDetail, GroupSummary } from '@rong/shared-types';

import { useResource } from '@/hooks/use-itineraries';

/** Nhóm của người dùng (F10). */
export function useGroups() {
  return useResource<GroupSummary[]>('/groups');
}

/** Một nhóm: thành viên (chủ nhóm trước), lịch trình, vai trò của mình. */
export function useGroup(id: string) {
  return useResource<GroupDetail>(`/groups/${id}`);
}
