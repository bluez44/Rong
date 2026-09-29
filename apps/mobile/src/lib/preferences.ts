import type { PlaceCategory } from '@rong/shared-types';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * Tùy chọn lưu trên máy, không cần đăng nhập (F11): đã xem giới thiệu chưa, và
 * sở thích chọn ở giới thiệu để điền sẵn vào form tạo lịch trình (F6).
 */
export type Preferences = {
  onboarded: boolean;
  interests: PlaceCategory[];
};

const KEY = 'rong.preferences';
const DEFAULTS: Preferences = { onboarded: false, interests: [] };

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

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** null khi chưa đọc xong. */
export function usePreferences(): Preferences | null {
  return useSyncExternalStore(subscribe, () => current);
}
