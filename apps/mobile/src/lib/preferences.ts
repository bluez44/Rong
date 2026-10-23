import type { PlaceCategory } from '@rong/shared-types';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * Tùy chọn lưu trên máy, không cần đăng nhập (F11): đã xem giới thiệu chưa, và
 * sở thích chọn ở giới thiệu / Tài khoản: điền sẵn form tạo lịch trình (F6) và
 * gửi lên server cho gợi ý ở trang chủ.
 */
type Preferences = {
  onboarded: boolean;
  interests: PlaceCategory[];
  /** Sở thích đổi trên máy mà chưa gửi được lên server; gửi lại lần mở app sau. */
  interestsDirty: boolean;
};

const KEY = 'rong.preferences';
const DEFAULTS: Preferences = { onboarded: false, interests: [], interestsDirty: false };

// Như session-storage: SecureStore không có trên web.
const store = {
  get: (): Promise<string | null> =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(KEY) ?? null) : SecureStore.getItemAsync(KEY),
  set: (value: string): Promise<void> =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.setItem(KEY, value)) : SecureStore.setItemAsync(KEY, value),
};

let current: Preferences | null = null;
const listeners = new Set<() => void>();

function emit(next: Preferences) {
  current = next;
  listeners.forEach((listener) => listener());
}

/** Đọc một lần khi mở app; lỗi đọc thì coi như lần đầu mở. */
export async function loadPreferences(): Promise<void> {
  try {
    const raw = await store.get();
    emit(raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) } : DEFAULTS);
  } catch {
    emit(DEFAULTS);
  }
}

export function updatePreferences(patch: Partial<Preferences>): void {
  const next = { ...(current ?? DEFAULTS), ...patch };
  emit(next);
  // Ghi hỏng thì lần sau hiện lại giới thiệu; không đáng chặn người dùng.
  store.set(JSON.stringify(next)).catch(() => {});
}

/**
 * Xoá sở thích khỏi máy khi đăng xuất / xoá tài khoản (F11). Cập nhật `current`
 * và ghi đĩa như `updatePreferences`, nhưng KHÔNG gọi `listeners`: bộ đồng bộ
 * sở thích của tài khoản vừa đăng xuất (`InterestsSync`) có thể còn đăng ký
 * tới khi React dọn effect xong; nếu hàm này cũng phát tin như một lần người
 * dùng đổi sở thích, bộ đó sẽ tưởng là một lần sửa thật và gửi mảng rỗng lên
 * chính tài khoản vừa đăng xuất. Tài khoản đăng nhập kế tiếp đọc giá trị này
 * qua `getPreferences()` khi `InterestsSync` của họ khởi động, không cần được
 * báo riêng; màn hình đang hiện sở thích (nếu có) cũng render lại đúng giá trị
 * mới ngay sau đó vì toàn bộ cây (app) bị tháo cùng lúc với trạng thái đăng
 * xuất, không cần `usePreferences` tự kích thêm.
 */
export function resetInterestsOnSignOut(): void {
  const next = { ...(current ?? DEFAULTS), interests: [], interestsDirty: false };
  current = next;
  store.set(JSON.stringify(next)).catch(() => {});
}

export function subscribePreferences(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Đọc ngoài React (đồng bộ sở thích). null khi chưa đọc xong. */
export function getPreferences(): Preferences | null {
  return current;
}

/** null khi chưa đọc xong. */
export function usePreferences(): Preferences | null {
  return useSyncExternalStore(subscribePreferences, () => current);
}
