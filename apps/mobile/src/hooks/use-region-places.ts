import type { ArticleSource, PlaceCategory, PlaceListItem, PlacesPage } from '@rong/shared-types';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

/** Vùng chưa có danh sách thì backend trả `building`: hỏi lại sau chừng này. */
const BUILDING_RETRY_MS = 3000;

type RegionPlacesState = {
  /** `building`: backend đang tổng hợp lần đầu cho vùng này (10–30 giây). */
  status: 'loading' | 'building' | 'done' | 'error';
  items: PlaceListItem[];
  /** Các bài viết mà danh sách dựa vào. */
  sources: ArticleSource[];
  attribution: string | null;
  error: ApiError | null;
};

const INITIAL: RegionPlacesState = { status: 'loading', items: [], sources: [], attribution: null, error: null };

/**
 * Địa điểm của vùng, tổng hợp từ bài viết và định vị bằng Google. Mọi mục có
 * id nên chọn được vào lịch trình. Mảng danh mục rỗng nghĩa là "Tất cả"
 * (backend tự bỏ Lưu trú).
 */
export function useRegionPlaces(regionId: string, categories: PlaceCategory[]) {
  const { authFetch } = useAuth();
  const [state, setState] = useState<RegionPlacesState>(INITIAL);
  // Tăng lên để tải lại (nút "Thử lại").
  const [attempt, setAttempt] = useState(0);
  const filter = categories.join(',');

  useEffect(() => {
    // Đổi bộ lọc giữa chừng thì bỏ phản hồi của bộ lọc cũ.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const params = new URLSearchParams();
        if (filter) params.set('categories', filter);
        const page = await authFetch<PlacesPage>(`/regions/${regionId}/places?${params}`);
        if (cancelled) return;
        if (page.status === 'building') {
          setState({ ...INITIAL, status: 'building' });
          timer = setTimeout(load, BUILDING_RETRY_MS);
          return;
        }
        setState({
          status: 'done',
          items: page.items,
          sources: page.sources ?? [],
          attribution: page.attribution,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        const apiError =
          error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.');
        setState((prev) => ({ ...prev, status: 'error', error: apiError }));
      }
    };

    // Bộ lọc đổi thì bỏ dữ liệu cũ và tải lại.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(INITIAL);
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [authFetch, regionId, filter, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
