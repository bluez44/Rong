import type { PlaceDetail } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

export type PlaceDetailState = {
  status: 'loading' | 'done' | 'error';
  place: PlaceDetail | null;
  error: ApiError | null;
};

/**
 * Chi tiết địa điểm (F5). Phần `google` là dữ liệu thời gian thực: chỉ giữ
 * trong state của màn hình, không lưu hay cache ra ngoài (PRD 7.4).
 */
export function usePlaceDetail(id: string) {
  const { authFetch } = useAuth();
  const [state, setState] = useState<PlaceDetailState>({ status: 'loading', place: null, error: null });
  // Thử lại khi lần trước chưa về thì chỉ nhận phản hồi mới nhất.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++latest.current;
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const place = await authFetch<PlaceDetail>(`/places/${id}`);
      if (requestId === latest.current) setState({ status: 'done', place, error: null });
    } catch (error) {
      if (requestId !== latest.current) return;
      const apiError = error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.');
      setState((prev) => ({ ...prev, status: 'error', error: apiError }));
    }
  }, [authFetch, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { ...state, retry: load };
}
