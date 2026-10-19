import type { PlaceCategory, UserProfile } from '@rong/shared-types';
import { useEffect, useRef } from 'react';

import { useAuth } from '@/auth/auth-context';
import { getPreferences, subscribePreferences, updatePreferences } from '@/lib/preferences';

/** Chờ người dùng ngừng bấm chip rồi mới gửi. */
const DEBOUNCE_MS = 800;

const same = (a: PlaceCategory[], b: PlaceCategory[]) =>
  a.length === b.length && a.every((c) => b.includes(c));

/**
 * Đồng bộ sở thích trên máy với server (spec 2026-10-19-home-recommendations):
 * khi mở app, server chưa có mà máy có thì đẩy lên, ngược lại lấy bản server;
 * sau đó mỗi lần đổi trên máy thì gửi lên (gộp các lần bấm liên tiếp).
 */
export function InterestsSync() {
  const { status, authFetch, updateInterests } = useAuth();
  const synced = useRef<PlaceCategory[] | null>(null);

  useEffect(() => {
    if (status !== 'signedIn') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const push = (interests: PlaceCategory[]) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await updateInterests(interests);
          if (cancelled) return;
          synced.current = interests;
          updatePreferences({ interestsDirty: false });
        } catch {
          // Mất mạng: giữ cờ, lần mở app sau gửi lại.
          updatePreferences({ interestsDirty: true });
        }
      }, DEBOUNCE_MS);
    };

    const start = async () => {
      // Chờ preferences đọc xong từ máy.
      while (!getPreferences() && !cancelled) await new Promise((r) => setTimeout(r, 50));
      const local = getPreferences();
      if (!local || cancelled) return;
      try {
        const me = await authFetch<UserProfile>('/users/me');
        if (cancelled) return;
        const server = me.interests ?? [];
        if (local.interestsDirty || (server.length === 0 && local.interests.length > 0)) {
          synced.current = server;
          push(local.interests);
        } else {
          synced.current = server;
          if (!same(server, local.interests)) updatePreferences({ interests: server });
        }
      } catch {
        // Không tải được hồ sơ: thử lại lần mở app sau.
      }
    };

    const unsubscribe = subscribePreferences(() => {
      const local = getPreferences();
      if (!local || synced.current === null) return;
      if (!same(local.interests, synced.current)) push(local.interests);
    });
    void start();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [status, authFetch, updateInterests]);

  return null;
}
