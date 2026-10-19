import type { PlaceCategory } from '@rong/shared-types';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * Tùy chọn lưu trên máy, không cần đăng nhập (F11): đã xem giới thiệu chưa, và
 * sở thích chọn ở giới thiệu / Tài khoản: điền sẵn form tạo lịch trình (F6) và
 * gửi lên server cho gợi ý ở trang chủ.
 */
export type Preferences = {
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
