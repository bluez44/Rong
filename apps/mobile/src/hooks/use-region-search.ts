import type { RegionSearchResult } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

const DEBOUNCE_MS = 250;
const MAX_QUERY_LENGTH = 100;

export type RegionSearchState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  results: RegionSearchResult[];
  /** Kết quả hiện tại đã hỏi thêm nguồn ngoài (người dùng bấm Tìm). */
  searchedOnline: boolean;
  error: ApiError | null;
};

const IDLE: RegionSearchState = { status: 'idle', results: [], searchedOnline: false, error: null };

/**
 * Gợi ý vùng khi gõ (chỉ đọc danh mục) và tìm thêm trên OpenStreetMap khi
 * bấm Tìm. Nominatim cấm dùng làm autocomplete nên `online` không bao giờ bật
 * trong lúc gõ.
 */
export function useRegionSearch(query: string) {
  const { authFetch } = useAuth();
  const [state, setState] = useState<RegionSearchState>(IDLE);
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
        const results = await authFetch<RegionSearchResult[]>(`/regions/search?${params}`);
        if (id === latest.current) setState({ status: 'done', results, searchedOnline: online, error: null });
      } catch (error) {
        if (id !== latest.current) return;
        const apiError = error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.');
        setState((prev) => ({ ...prev, status: 'error', error: apiError }));
      }
    },
    [authFetch],
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

  return { ...(q ? state : IDLE), query: q, submit, retry };
}
