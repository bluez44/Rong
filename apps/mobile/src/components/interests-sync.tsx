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
  // authFetch/updateInterests đổi định danh mỗi khi session đổi (ví dụ làm mới
  // token lúc đang chờ hẹn giờ gửi): đọc qua ref cập nhật sau mỗi lần render
  // (không được ghi ref ngay trong lúc render), để effect dưới đây không phải
  // phụ thuộc vào chúng và không bị huỷ hẹn giờ đang chờ giữa chừng.
  const authFetchRef = useRef(authFetch);
  const updateInterestsRef = useRef(updateInterests);
  useEffect(() => {
    authFetchRef.current = authFetch;
    updateInterestsRef.current = updateInterests;
  }, [authFetch, updateInterests]);

  useEffect(() => {
    if (status !== 'signedIn') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const push = (interests: PlaceCategory[]) => {
      // Đánh dấu dơ ngay khi xếp hàng gửi, không chờ hẹn giờ chạy xong: hẹn giờ
      // bị huỷ giữa chừng (tắt app, đăng xuất...) thì sở thích vẫn được gửi lại
      // ở lần mở app sau nhờ cờ này.
      updatePreferences({ interestsDirty: true });
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await updateInterestsRef.current(interests);
          if (cancelled) return;
          synced.current = interests;
          updatePreferences({ interestsDirty: false });
        } catch {
          // Mất mạng: cờ đã dơ từ trước, lần mở app sau gửi lại.
        }
      }, DEBOUNCE_MS);
    };

    const start = async () => {
      // Chờ preferences đọc xong từ máy.
      while (!getPreferences() && !cancelled) await new Promise((r) => setTimeout(r, 50));
      const local = getPreferences();
      if (!local || cancelled) return;
      try {
        const me = await authFetchRef.current<UserProfile>('/users/me');
        if (cancelled) return;
        const server = me.interests ?? [];
        // Chỉ coi là "có sở thích chưa gửi" khi máy thực sự còn sở thích: nếu
        // không thì không có gì để đẩy lên (tránh đẩy nhầm mảng rỗng che mất
        // sở thích thật của tài khoản — xem báo cáo, kịch bản đổi tài khoản).
        if (local.interests.length > 0 && (local.interestsDirty || server.length === 0)) {
          synced.current = server;
          push(local.interests);
        } else {
          synced.current = server;
          if (!same(server, local.interests)) updatePreferences({ interests: server, interestsDirty: false });
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
    // Chỉ chạy lại khi đăng nhập/đăng xuất đổi: authFetch/updateInterests đọc
    // qua ref ở trên, không đưa vào đây để làm mới token giữa chừng không huỷ
    // hẹn giờ gửi đang chờ (xem comment ref phía trên).
  }, [status]);

  return null;
}
