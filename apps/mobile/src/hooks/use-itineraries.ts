import type { Itinerary, ItinerarySummary } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

type LoadState<T> = {
  /** `refreshing`: đã có dữ liệu, đang tải lại (kéo để làm mới, quay lại tab). */
  status: 'loading' | 'refreshing' | 'done' | 'error';
  data: T | null;
  error: ApiError | null;
};

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.');
}

/** Tải một tài nguyên; gọi `reload` để tải lại mà vẫn giữ dữ liệu cũ trên màn hình. */
function useResource<T>(path: string) {
  const { authFetch } = useAuth();
  const [state, setState] = useState<LoadState<T>>({ status: 'loading', data: null, error: null });
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++latest.current;
    setState((prev) => ({ ...prev, status: prev.data ? 'refreshing' : 'loading', error: null }));
    try {
      const data = await authFetch<T>(path);
      if (requestId === latest.current) setState({ status: 'done', data, error: null });
    } catch (error) {
      if (requestId === latest.current) setState((prev) => ({ ...prev, status: 'error', error: toApiError(error) }));
    }
  }, [authFetch, path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, reload };
}

/** Danh sách lịch trình của người dùng, mới nhất trước. */
export function useItineraries() {
  return useResource<ItinerarySummary[]>('/itineraries');
}

export function useItinerary(id: string) {
  return useResource<Itinerary>(`/itineraries/${id}`);
}
