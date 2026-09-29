import type { PlaceCategory, PlaceListItem, PlacesPage } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

const PAGE_SIZE = 20;

/**
 * - `v2`: AI tìm web và đọc bài viết (nhanh hơn với vùng mới mở), một trang
 *   duy nhất, mỗi mục kèm bài viết nguồn. Không có nơi lưu trú.
 * - `v1`: danh mục OSM, phân trang, mọi mục có id.
 */
export type PlacesApi = 'v1' | 'v2';

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
 * Danh sách địa điểm của vùng, phân trang theo con trỏ (v1). Đổi bộ lọc danh
 * mục thì tải lại từ đầu. Mảng rỗng nghĩa là "Tất cả" (backend tự bỏ Lưu trú).
 */
export function useRegionPlaces(regionId: string, categories: PlaceCategory[], api: PlacesApi = 'v1') {
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
        const params = new URLSearchParams();
        if (api === 'v1') params.set('limit', String(PAGE_SIZE));
        if (filter) params.set('categories', filter);
        if (cursor) params.set('cursor', cursor);
        const path = api === 'v2' ? `/v2/regions/${regionId}/places` : `/regions/${regionId}/places`;
        const page = await authFetch<PlacesPage>(`${path}?${params}`);
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
    [authFetch, regionId, filter, api],
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
