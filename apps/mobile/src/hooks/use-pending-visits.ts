import type { PendingVisitReview } from '@rong/shared-types';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/auth/auth-context';

/** Chuyến đã kết thúc chưa xác nhận "đã đến những nơi nào" — chỉ chuyến mới nhất. "Để sau" ẩn trong phiên. */
export function usePendingVisits() {
  const { authFetch } = useAuth();
  const [pending, setPending] = useState<PendingVisitReview | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const list = await authFetch<PendingVisitReview[]>('/visits/pending');
      setPending(list.find((p) => !dismissed.has(p.itineraryId)) ?? null);
    } catch {
      // Không quan trọng: lần mở trang chủ sau thử lại.
    }
  }, [authFetch, dismissed]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const dismiss = useCallback(() => {
    if (pending) setDismissed((s) => new Set(s).add(pending.itineraryId));
  }, [pending]);

  const submit = useCallback(
    async (visitedPlaceIds: string[]) => {
      if (!pending) return;
      await authFetch<void>('/visits/review', {
        method: 'POST',
        body: { itineraryId: pending.itineraryId, visitedPlaceIds },
      });
      await load();
    },
    [authFetch, pending, load],
  );

  return { pending, dismiss, submit };
}
