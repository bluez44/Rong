import type { PendingVisitReview } from '@rong/shared-types';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

/**
 * Chuyến đã kết thúc chưa xác nhận "đã đến những nơi nào" — chỉ hỏi chuyến mới nhất.
 * "Để sau" ẩn lời hỏi tới hết phiên (không hỏi tiếp chuyến cũ hơn), không cần gọi mạng.
 */
export function usePendingVisits() {
  const { authFetch } = useAuth();
  const [list, setList] = useState<PendingVisitReview[]>([]);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await authFetch<PendingVisitReview[]>('/visits/pending'));
    } catch {
      // Không quan trọng: lần mở trang chủ sau thử lại.
    }
  }, [authFetch]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const pending = dismissed ? null : (list[0] ?? null);

  const dismiss = useCallback(() => setDismissed(true), []);

  const drop = (itineraryId: string) => setList((cur) => cur.filter((p) => p.itineraryId !== itineraryId));

  const submit = useCallback(
    async (itineraryId: string, visitedPlaceIds: string[]) => {
      try {
        await authFetch<void>('/visits/review', { method: 'POST', body: { itineraryId, visitedPlaceIds } });
      } catch (e) {
        // Lịch trình đã bị xoá: thôi hỏi chuyến này, vẫn báo lỗi cho người dùng.
        if (e instanceof ApiError && e.code === 'ITINERARY_NOT_FOUND') drop(itineraryId);
        throw e;
      }
      // Bỏ ngay khỏi danh sách để lần tải lại có lỗi cũng không hỏi lại chuyến vừa trả lời.
      drop(itineraryId);
      await load();
    },
    [authFetch, load],
  );

  return { pending, dismiss, submit };
}
