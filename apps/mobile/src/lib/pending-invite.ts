import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Link mời nhóm chờ mở (F10). App nhận link ở `+native-intent.tsx` trước khi biết người dùng đã đăng nhập chưa, nên
 * token được giữ ở đây (và trong SecureStore, phòng app bị tắt giữa lúc đăng ký và xác minh email). Nhóm màn `(app)`
 * chỉ mount khi đã onboarding và đăng nhập; lúc đó `usePendingInviteRedirect` mở màn chấp nhận lời mời.
 */

const KEY = 'pendingInviteToken';

// Như session-storage: SecureStore không có trên web.
const store = {
  get: (): Promise<string | null> =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(KEY) ?? null) : SecureStore.getItemAsync(KEY),
  set: (value: string): Promise<void> =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.setItem(KEY, value)) : SecureStore.setItemAsync(KEY, value),
  clear: (): Promise<void> =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.removeItem(KEY)) : SecureStore.deleteItemAsync(KEY),
};

let pending: string | null = null;
let restored = false;
const listeners = new Set<() => void>();

export function setPendingInvite(token: string): void {
  pending = token;
  store.set(token).catch(() => undefined);
  for (const listener of listeners) listener();
}

/** Lấy token đang chờ (kể cả token lưu từ lần mở app trước) rồi xoá, để mỗi link chỉ mở một lần. */
async function takePendingInvite(): Promise<string | null> {
  if (!restored) {
    restored = true;
    const saved = await store.get().catch(() => null);
    pending ??= saved;
  }
  const token = pending;
  pending = null;
  if (token) store.clear().catch(() => undefined);
  return token;
}

/** Đặt trong layout của `(app)`: mở màn chấp nhận lời mời khi có link chờ, lúc vào app hoặc khi link tới sau đó. */
export function usePendingInviteRedirect(): void {
  useEffect(() => {
    const open = async () => {
      const token = await takePendingInvite();
      if (token) router.push({ pathname: '/invite/[token]', params: { token } });
    };
    const listener = () => void open();
    listeners.add(listener);
    void open();
    return () => {
      listeners.delete(listener);
    };
  }, []);
}
