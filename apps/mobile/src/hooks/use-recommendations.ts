import type { RecommendationFeed } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

const BUILDING_RETRY_MS = 3000;
/** ~30 giây: quá chừng này mà vẫn `building` thì báo và cho thử lại. */
const MAX_POLLS = 10;

type Status = 'loading' | 'building' | 'ready' | 'timeout' | 'error';

/**
 * Bảng tin gợi ý ở trang chủ (spec 2026-10-19-home-recommendations). Backend
 * trả `building` khi đang tạo bộ cho khung giờ này: hỏi lại mỗi 3 giây. Quay
 * lại app sau mốc làm mới (6:00/15:00) thì tải bộ mới.
 */
export function useRecommendations(theme: string) {
  const { authFetch } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [feed, setFeed] = useState<RecommendationFeed | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState({ n: 0, retry: false });
  const nextRefreshAt = useRef<number | null>(null);
  /** `refresh()` tải lại ngầm: giữ thẻ đang hiện, không về khung xương. */
  const silent = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const quiet = silent.current;
    silent.current = false;

    const load = async (retry: boolean) => {
      try {
        const params = new URLSearchParams({ theme });
        if (retry) params.set('retry', '1');
        const next = await authFetch<RecommendationFeed>(`/recommendations?${params}`);
        if (cancelled) return;
        setFeed(next);
        setError(null);
        nextRefreshAt.current = Date.parse(next.nextRefreshAt);
        if (next.status === 'ready') {
          setStatus('ready');
          return;
        }
        if (++polls >= MAX_POLLS) {
          setStatus('timeout');
          return;
        }
        setStatus('building');
        timer = setTimeout(() => load(false), BUILDING_RETRY_MS);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.'));
        // Tải lại ngầm mà lỗi: chỉ giữ nguyên khi thẻ đang hiện; còn lại (khung xương, đang tạo) phải báo lỗi.
        setStatus((s) => (quiet && s === 'ready' ? s : 'error'));
      }
    };

    // Đổi chủ đề: bỏ thẻ cũ để không hiện nhầm thẻ của chủ đề trước.
    if (!quiet) setStatus('loading');
    void load(attempt.retry);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [authFetch, theme, attempt]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && nextRefreshAt.current !== null && Date.now() >= nextRefreshAt.current) {
        setAttempt((a) => ({ n: a.n + 1, retry: false }));
      }
    });
    return () => sub.remove();
  }, []);

  const retry = useCallback(() => setAttempt((a) => ({ n: a.n + 1, retry: true })), []);
  const reload = useCallback(() => setAttempt((a) => ({ n: a.n + 1, retry: false })), []);
  /** Tải lại ngầm, ví dụ khi quay về trang chủ sau khi lưu một gợi ý (`savedItineraryId`). */
  const refresh = useCallback(() => {
    silent.current = true;
    setAttempt((a) => ({ n: a.n + 1, retry: false }));
  }, []);
  return { status, feed, error, retry, reload, refresh };
}
