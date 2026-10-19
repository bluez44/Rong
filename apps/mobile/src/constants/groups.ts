import type { GroupRole } from '@rong/shared-types';

/** Nhãn vai trò trong nhóm (FR-10.4). */
export const ROLE_LABELS: Record<GroupRole, string> = {
  owner: 'Chủ nhóm',
  editor: 'Chỉnh sửa',
  viewer: 'Chỉ xem',
};

/** Dòng nhãn đầu màn chi tiết nhóm. */
export const MY_ROLE_LINES: Record<GroupRole, string> = {
  owner: 'Bạn là chủ nhóm',
  editor: 'Bạn có quyền chỉnh sửa',
  viewer: 'Bạn chỉ xem',
};

/** Tối đa hai chữ cái đầu, viết hoa, cho ảnh đại diện chữ. */
export function initials(name: string | null): string {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length === 0) return '?';
  const picked = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
  return picked
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase('vi-VN');
}
