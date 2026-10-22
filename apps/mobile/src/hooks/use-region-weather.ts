import type { RegionWeather } from '@rong/shared-types';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';

/**
 * Thời tiết từng ngày của chuyến. Chỉ hỏi server khi ngày đứng yên `debounceMs` (đang cuộn bộ chọn ngày thì chưa),
 * phản hồi của ngày cũ về muộn thì bỏ. Thông tin phụ: lỗi hay `unavailable` → `weather: null`, không báo lỗi.
 */
export function useRegionWeather(
  regionId: string | undefined,
  from: string | null,
  to: string | null,
  debounceMs = 400,
): { weather: RegionWeather | null; loading: boolean } {
  const { authFetch } = useAuth();
  const [state, setState] = useState<{ key: string; weather: RegionWeather | null } | null>(null);
  const latest = useRef(0);
  const key = regionId && from && to ? `${regionId}:${from}:${to}` : null;

  useEffect(() => {
    if (!key) return;
    const id = ++latest.current;
    const timer = setTimeout(() => {
      authFetch<RegionWeather>(`/regions/${regionId}/weather?from=${from}&to=${to}`)
        .then((w) => {
          if (id === latest.current) setState({ key, weather: w?.status === 'ready' && w.days.length > 0 ? w : null });
        })
        .catch(() => {
          if (id === latest.current) setState({ key, weather: null });
        });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [key, regionId, from, to, debounceMs, authFetch]);

  const current = state?.key === key ? state : null;
  return { weather: current?.weather ?? null, loading: key !== null && current === null };
}
