import type { SavedPlace } from '@rong/shared-types';
import { router } from 'expo-router';

import { tripDraft, type DraftPlace } from '@/lib/trip-draft';

/**
 * "Xếp lịch giúp tôi" ở một nhóm vùng của "Muốn đi" (FR-9.2): các điểm "Muốn đi" của vùng thành địa điểm đã chọn,
 * điểm lưu trú lưu gần nhất (`data` xếp mới nhất trước) là nơi ở. Rồi mở màn Vùng để người dùng xem bản đồ, thêm điểm
 * khác của vùng và bấm "Lập lịch trình" (AI sắp xếp hoặc Tự xếp).
 */
export function planFromSaved(group: { regionId: string; regionName: string; data: SavedPlace[] }) {
  const toDraft = (p: SavedPlace): DraftPlace => ({ id: p.placeId, name: p.name, category: p.category });
  const stay = group.data.find((p) => p.category === 'stay');
  tripDraft.replace(
    group.regionId,
    group.data.filter((p) => p.category !== 'stay').map(toDraft),
    stay ? toDraft(stay) : null,
  );
  router.push({ pathname: '/region/[id]', params: { id: group.regionId, name: group.regionName } });
}
