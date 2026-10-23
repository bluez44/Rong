import type { GooglePlacePreviewResponse } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

type GooglePlacePreviewState = {
  status: 'loading' | 'done' | 'error';
  data: GooglePlacePreviewResponse | null;
  error: ApiError | null;
};

/**
 * Xem trước một địa điểm Google chưa có trong Rong. Dữ liệu Google chỉ nằm trong
 * state của màn hình, không lưu hay cache ra ngoài (PRD 7.4).
 */
export function useGooglePlacePreview(googlePlaceId: string) {
  const { authFetch } = useAuth();
  const [state, setState] = useState<GooglePlacePreviewState>({ status: 'loading', data: null, error: null });
  // Thử lại khi lần trước chưa về thì chỉ nhận phản hồi mới nhất.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++latest.current;
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const data = await authFetch<GooglePlacePreviewResponse>(`/places/google/${encodeURIComponent(googlePlaceId)}`);
      if (requestId === latest.current) setState({ status: 'done', data, error: null });
    } catch (error) {
      if (requestId !== latest.current) return;
      const apiError = error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.');
      setState((prev) => ({ ...prev, status: 'error', error: apiError }));
    }
  }, [authFetch, googlePlaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { ...state, reload: load };
}
