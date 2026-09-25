import type { PlaceCategory, PlaceListItem, PlacesPage } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

const PAGE_SIZE = 20;

export type RegionPlacesState = {
  /** `loading`: trang đầu; `loadingMore`: trang tiếp theo. */
  status: 'loading' | 'loadingMore' | 'done' | 'error';
  items: PlaceListItem[];
  nextCursor: string | null;
  attribution: string | null;
  source: PlacesPage['source'] | null;
  groundingSources: NonNullable<PlacesPage['groundingSources']>;
  error: ApiError | null;
};

const INITIAL: RegionPlacesState = {
  status: 'loading',
  items: [],
  nextCursor: null,
  attribution: null,
  source: null,
  groundingSources: [],
  error: null,
};

/**
 * Danh sách địa điểm của vùng, phân trang theo con trỏ. Đổi bộ lọc danh mục
 * thì tải lại từ đầu. Mảng rỗng nghĩa là "Tất cả" (backend tự bỏ Lưu trú).
 */
export function useRegionPlaces(regionId: string, categories: PlaceCategory[]) {
  const { authFetch } = useAuth();
  const [state, setState] = useState<RegionPlacesState>(INITIAL);
  // Đổi bộ lọc giữa chừng thì bỏ phản hồi của bộ lọc cũ.
  const latest = useRef(0);
  const filter = categories.join(',');

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const id = ++latest.current;
      setState((prev) =>
        cursor ? { ...prev, status: 'loadingMore', error: null } : { ...INITIAL, status: 'loading' },
      );
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (filter) params.set('categories', filter);
        if (cursor) params.set('cursor', cursor);
        const page = await authFetch<PlacesPage>(`/regions/${regionId}/places?${params}`);
        if (id !== latest.current) return;
        setState((prev) => ({
          status: 'done',
          items: cursor ? [...prev.items, ...page.items] : page.items,
          nextCursor: page.nextCursor,
          attribution: page.attribution,
          source: page.source,
          groundingSources: page.groundingSources ?? [],
          error: null,
        }));
      } catch (error) {
        if (id !== latest.current) return;
        const apiError = error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.');
        setState((prev) => ({ ...prev, status: 'error', error: apiError }));
      }
    },
    [authFetch, regionId, filter],
  );

  useEffect(() => {
    // Bộ lọc đổi thì bỏ dữ liệu cũ và tải lại từ trang đầu.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPage(null);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (state.status === 'done' && state.nextCursor) fetchPage(state.nextCursor);
  }, [fetchPage, state.status, state.nextCursor]);

  // Lỗi ở trang sau thì thử lại đúng trang đó, không tải lại từ đầu.
  const retry = useCallback(() => {
    fetchPage(state.items.length > 0 ? state.nextCursor : null);
  }, [fetchPage, state.items.length, state.nextCursor]);

  return { ...state, loadMore, retry };
}
