import type { PlaceCategory, SavedPlace } from '@rong/shared-types';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

/** Địa điểm có trong danh mục (có id) — mục AI chưa khớp danh mục thì không lưu được. */
export type SaveablePlace = { id: string; name: string; category: PlaceCategory };

type SavedPlacesValue = {
  status: 'loading' | 'refreshing' | 'done' | 'error';
  items: SavedPlace[];
  error: ApiError | null;
  reload: () => void;
  isSaved: (placeId: string) => boolean;
  /** Thả/bỏ tim. Cập nhật ngay trên màn hình; lỗi thì trả lại như cũ và báo. */
  toggle: (place: SaveablePlace, region: { id: string; name: string }) => void;
};

const SavedPlacesContext = createContext<SavedPlacesValue | null>(null);

/**
 * Danh sách "Muốn đi" (F9) dùng chung cho mọi màn trong phiên đăng nhập: nút
 * tim ở bản đồ vùng, chi tiết địa điểm và màn "Muốn đi" luôn khớp nhau.
 */
export function SavedPlacesProvider({ children }: { children: ReactNode }) {
  const { authFetch } = useAuth();
  const [status, setStatus] = useState<SavedPlacesValue['status']>('loading');
  const [items, setItems] = useState<SavedPlace[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const loaded = useRef(false);
  // Bản mới nhất để `toggle` biết địa điểm đang lưu hay chưa ngay trong lượt bấm; mọi chỗ gán `items` đều cập nhật nó.
  const itemsRef = useRef<SavedPlace[]>([]);
  // Lượt tải cũ trả về sau một lần thả tim thì không được ghi đè.
  const version = useRef(0);

  const reload = useCallback(async () => {
    const current = ++version.current;
    setStatus(loaded.current ? 'refreshing' : 'loading');
    setError(null);
    try {
      const data = await authFetch<SavedPlace[]>('/saved-places');
      if (current !== version.current) return;
      loaded.current = true;
      itemsRef.current = data;
      setItems(data);
      setStatus('done');
    } catch (e) {
      if (current !== version.current) return;
      setError(toApiError(e));
      setStatus('error');
    }
  }, [authFetch]);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggle = useCallback<SavedPlacesValue['toggle']>(
    (place, region) => {
      version.current++;
      const existing = itemsRef.current.find((s) => s.placeId === place.id);
      const next = existing
        ? itemsRef.current.filter((s) => s.placeId !== place.id)
        : [
            {
              placeId: place.id,
              name: place.name,
              category: place.category,
              regionId: region.id,
              regionName: region.name,
              savedAt: new Date().toISOString(),
            },
            ...itemsRef.current,
          ];
      itemsRef.current = next;
      setItems(next);

      const request = existing
        ? authFetch<void>(`/saved-places/${place.id}`, { method: 'DELETE' })
        : authFetch<void>(`/saved-places/${place.id}`, { method: 'PUT', body: { regionId: region.id } });
      request.catch((e) => {
        const rest = itemsRef.current.filter((s) => s.placeId !== place.id);
        const reverted = existing ? [existing, ...rest].sort((a, b) => b.savedAt.localeCompare(a.savedAt)) : rest;
        itemsRef.current = reverted;
        setItems(reverted);
        Alert.alert(existing ? 'Chưa bỏ lưu được' : 'Chưa lưu được', toApiError(e).message);
      });
    },
    [authFetch],
  );

  const value = useMemo<SavedPlacesValue>(() => {
    const ids = new Set(items.map((s) => s.placeId));
    return { status, items, error, reload, isSaved: (id) => ids.has(id), toggle };
  }, [status, items, error, reload, toggle]);

  return <SavedPlacesContext.Provider value={value}>{children}</SavedPlacesContext.Provider>;
}

export function useSavedPlaces(): SavedPlacesValue {
  const value = useContext(SavedPlacesContext);
  if (!value) throw new Error('useSavedPlaces phải nằm trong SavedPlacesProvider');
  return value;
}

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.');
}
