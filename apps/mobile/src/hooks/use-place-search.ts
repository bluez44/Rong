import type { GooglePlaceHit, PlaceSearchHit, PlaceSearchResponse } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

const DEBOUNCE_MS = 300;
const MAX_QUERY_LENGTH = 100;

type State = {
  status: 'idle' | 'loading' | 'done' | 'error';
  catalog: PlaceSearchHit[];
  existing: PlaceSearchHit[];
  google: GooglePlaceHit[] | null;
  /** Kết quả hiện tại đã hỏi Google (người dùng bấm Tìm trên Google Maps). */
  searchedOnline: boolean;
  error: ApiError | null;
};

const IDLE: State = { status: 'idle', catalog: [], existing: [], google: null, searchedOnline: false, error: null };

/**
 * Tìm địa điểm theo tên trong một vùng. Khi gõ chỉ tìm trong danh mục của Rong
 * (debounce); Google chỉ được hỏi khi người dùng chủ động `submit`, vì mỗi lần
 * tính vào hạn mức ngày.
 */
export function usePlaceSearch(regionId: string, query: string) {
  const { authFetch } = useAuth();
  const [state, setState] = useState<State>(IDLE);
  // Chỉ nhận phản hồi của lần gọi mới nhất; lần cũ về muộn thì bỏ.
  const latest = useRef(0);
  const lastOnline = useRef(false);
  const q = query.trim().slice(0, MAX_QUERY_LENGTH);

  const run = useCallback(
    async (text: string, online: boolean) => {
      const id = ++latest.current;
      lastOnline.current = online;
      // Giữ kết quả cũ trong lúc chờ để danh sách không nháy trắng.
      setState((prev) => ({ ...prev, status: 'loading', error: null }));
      try {
        const params = new URLSearchParams({ q: text });
        if (online) params.set('online', 'true');
        const res = await authFetch<PlaceSearchResponse>(`/regions/${regionId}/places/search?${params}`);
        if (id === latest.current) {
          setState({ status: 'done', catalog: res.catalog, existing: res.existing, google: res.google, searchedOnline: online, error: null });
        }
      } catch (error) {
        if (id !== latest.current) return;
        const apiError = error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.');
        setState((prev) => ({ ...prev, status: 'error', error: apiError }));
      }
    },
    [authFetch, regionId],
  );

  useEffect(() => {
    if (!q) {
      // Bỏ phản hồi còn đang bay; trạng thái idle được suy ra bên dưới.
      latest.current++;
      return;
    }
    const timer = setTimeout(() => run(q, false), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, run]);

  const submit = useCallback(() => {
    if (q) run(q, true);
  }, [q, run]);

  const retry = useCallback(() => {
    if (q) run(q, lastOnline.current);
  }, [q, run]);

  return { ...(q ? state : IDLE), submit, retry };
}
