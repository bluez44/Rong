import type { CurrentItineraryShareLink, ItineraryShareLink } from '@rong/shared-types';

import type { Fetcher } from '@/api/client';

/** Link xem lịch trình (FR-10.3): trang `/t/<token>` của apps/web, mở được mà không cần app. */
const WEB_BASE_URL = (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export function itineraryShareUrl(token: string): string {
  return `${WEB_BASE_URL}/t/${token}`;
}

/**
 * Token của link đang hiệu lực. Người sửa được dùng PUT (lấy hoặc tạo, không thu hồi link đã gửi, kể cả khi hai người
 * bấm chia sẻ cùng lúc); người chỉ xem chỉ đọc. Null: người chỉ xem và lịch trình chưa có link.
 */
export async function resolveShareToken(
  authFetch: Fetcher,
  itineraryId: string,
  canCreate: boolean,
): Promise<string | null> {
  const path = `/itineraries/${itineraryId}/share-link`;
  if (canCreate) return (await authFetch<ItineraryShareLink>(path, { method: 'PUT' })).token;
  const { link } = await authFetch<CurrentItineraryShareLink>(path);
  return link?.token ?? null;
}
