import type { CurrentItineraryShareLink, ItineraryShareLink } from '@rong/shared-types';

import type { RequestOptions } from '@/lib/api';

/** Link xem lịch trình (FR-10.3): trang `/t/<token>` của apps/web, mở được mà không cần app. */
const WEB_BASE_URL = (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export function itineraryShareUrl(token: string): string {
  return `${WEB_BASE_URL}/t/${token}`;
}

type AuthFetch = <T>(path: string, options?: Omit<RequestOptions, 'token'>) => Promise<T>;

/**
 * Token của link đang hiệu lực; chưa có thì người sửa được tạo mới. Không tạo lại khi đã có link, vì tạo mới sẽ thu
 * hồi link đã gửi cho người khác. Null: người chỉ xem và lịch trình chưa có link.
 */
export async function resolveShareToken(
  authFetch: AuthFetch,
  itineraryId: string,
  canCreate: boolean,
): Promise<string | null> {
  const path = `/itineraries/${itineraryId}/share-link`;
  const { link } = await authFetch<CurrentItineraryShareLink>(path);
  if (link) return link.token;
  if (!canCreate) return null;
  return (await authFetch<ItineraryShareLink>(path, { method: 'POST' })).token;
}
