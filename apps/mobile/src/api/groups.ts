import type { CreatedGroupInvite, GroupDetail, GroupSummary, InviteRole } from '@rong/shared-types';

import type { Fetcher } from './client';

export const groupsApi = (f: Fetcher) => ({
  list: () => f<GroupSummary[]>('/groups'),
  get: (id: string) => f<GroupDetail>(`/groups/${id}`),
  create: (name: string) => f<GroupDetail>('/groups', { method: 'POST', body: { name } }),
  rename: (id: string, name: string) => f<void>(`/groups/${id}`, { method: 'PATCH', body: { name } }),
  remove: (id: string) => f<void>(`/groups/${id}`, { method: 'DELETE' }),
  setMemberRole: (groupId: string, userId: string, role: InviteRole) =>
    f<void>(`/groups/${groupId}/members/${userId}`, { method: 'PATCH', body: { role } }),
  /** Cả rời nhóm (chính mình) lẫn mời người khác ra. */
  removeMember: (groupId: string, userId: string) =>
    f<void>(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
  createInvite: (groupId: string, role: InviteRole) =>
    f<CreatedGroupInvite>(`/groups/${groupId}/invites`, { method: 'POST', body: { role } }),
  /** Đưa lịch trình về danh sách riêng của người tạo, không xóa. */
  removeItinerary: (groupId: string, itineraryId: string) =>
    f<void>(`/groups/${groupId}/itineraries/${itineraryId}`, { method: 'DELETE' }),
});
