import type { ItinerarySummary } from './itinerary';
import type { PlaceCategory } from './place';

/**
 * Nhóm và chia sẻ — PRD mục 7.2, F10. Thiết kế: spec S8
 * (docs/superpowers/specs/2026-10-02-backend-s8-groups-design.md).
 */
export type GroupRole = 'owner' | 'editor' | 'viewer';

/** Vai trò một link mời có thể cấp. Mặc định 'viewer' — FR-10.4. */
export type InviteRole = Exclude<GroupRole, 'owner'>;

/** Một dòng trong "nhóm của tôi". */
export interface GroupSummary {
  id: string;
  name: string;
  myRole: GroupRole;
  memberCount: number;
  itineraryCount: number;
  createdAt: string;
}

/** Không có email: thành viên chỉ thấy tên hiển thị của nhau. */
export interface GroupMember {
  userId: string;
  displayName: string | null;
  role: GroupRole;
  joinedAt: string;
}

export interface GroupDetail {
  id: string;
  name: string;
  ownerId: string;
  myRole: GroupRole;
  createdAt: string;
  /** Owner trước, rồi editor, rồi viewer; cùng vai trò thì ai vào trước đứng trước. */
  members: GroupMember[];
  itineraries: ItinerarySummary[];
}

/** Link mời còn hiệu lực. Token chỉ trả về đúng một lần, lúc tạo. */
export interface GroupInvite {
  id: string;
  role: InviteRole;
  expiresAt: string;
  createdAt: string;
}

export interface CreatedGroupInvite extends GroupInvite {
  /** Đưa vào deep link. Server chỉ lưu bản băm, không lấy lại được. */
  token: string;
}

/** GET /invites/:token — xem trước, không cần đăng nhập. */
export interface InvitePreview {
  groupName: string;
  inviterName: string | null;
  role: InviteRole;
  memberCount: number;
  expiresAt: string;
}

/** Địa điểm chung của nhóm — FR-10.9. */
export interface GroupPlace {
  placeId: string;
  name: string;
  category: PlaceCategory;
  regionId: string;
  regionName: string;
  addedByName: string | null;
  addedAt: string;
}

export type GroupActivityType =
  | 'member_joined'
  | 'member_left'
  | 'member_removed'
  | 'role_changed'
  | 'group_renamed'
  | 'itinerary_added'
  | 'itinerary_removed'
  | 'itinerary_updated'
  | 'place_added'
  | 'place_removed';

/** Nhật ký hoạt động — FR-10.5. `payload` giữ tên tại thời điểm xảy ra. */
export interface GroupActivity {
  id: string;
  type: GroupActivityType;
  /** null khi tài khoản đã bị xóa — client hiện "Người dùng đã xóa". */
  actorId: string | null;
  actorName: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}
