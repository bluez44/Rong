/**
 * Nhóm và chia sẻ — PRD mục 7.2, F10.
 */
export type GroupRole = 'owner' | 'editor' | 'viewer';

export interface Group {
  id: string;
  name: string;
  coverImageUrl?: string | null;
  ownerId: string;
  createdAt: string;
}

export interface GroupMember {
  groupId: string;
  userId: string;
  role: GroupRole;
  joinedAt: string;
}

export interface InviteLink {
  token: string;
  groupId: string;
  /** Vai trò mặc định của người được mời là 'viewer' — FR-10.4. */
  defaultRole: Exclude<GroupRole, 'owner'>;
  expiresAt: string;
  revokedAt?: string | null;
}
