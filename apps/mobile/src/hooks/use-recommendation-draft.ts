import type { Itinerary, ItineraryDraft, PreviewDraftRequest } from '@rong/shared-types';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

const toApiError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.');

/** Bản nháp của một gợi ý: xem, đổi thông số (xếp lại), lưu thành lịch trình. */
export function useRecommendationDraft(id: string) {
  const { authFetch } = useAuth();
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [draft, setDraft] = useState<ItineraryDraft | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // id rỗng (bản đồ ngày của lịch trình đã lưu): không gọi API, giữ 'loading'.
    if (!id) return;
    let cancelled = false;
    authFetch<ItineraryDraft>(`/recommendations/${id}`)
      .then((d) => {
        if (cancelled) return;
        setDraft(d);
        setStatus('done');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(toApiError(e));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [authFetch, id, attempt]);

  /** Lỗi ném ra cho sheet hiện; bản nháp đang xem giữ nguyên. */
  const preview = useCallback(
    async (req: PreviewDraftRequest) => {
      setPreviewing(true);
      try {
        setDraft(await authFetch<ItineraryDraft>(`/recommendations/${id}/preview`, { method: 'POST', body: req }));
      } catch (e) {
        throw toApiError(e);
      } finally {
        setPreviewing(false);
      }
    },
    [authFetch, id],
  );

  const save = useCallback(async () => {
    if (!draft) throw new ApiError(0, 'UNKNOWN', 'Bản nháp chưa tải xong.');
    setSaving(true);
    try {
      return await authFetch<Itinerary>(`/recommendations/${id}/save`, {
        method: 'POST',
        body: { draftId: draft.draftId },
      });
    } catch (e) {
      throw toApiError(e);
    } finally {
      setSaving(false);
    }
  }, [authFetch, draft, id]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { status, draft, error, reload, preview, previewing, save, saving };
}
