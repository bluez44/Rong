import type { UserProfile } from '@rong/shared-types';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type Session = {
  accessToken: string;
  /** Mốc hết hạn của accessToken, ms kể từ epoch. */
  expiresAt: number;
  /**
   * Đổi lấy accessToken mới khi hết hạn (sống 60 ngày, mỗi lần đổi tính lại).
   * Phiên lưu từ trước khi có refresh token thì không có trường này.
   */
  refreshToken?: string;
  user: UserProfile;
};

const KEY = 'rong.session';

// SecureStore không có trên web; bản web chỉ dùng để xem giao diện nên localStorage là đủ.
const store = {
  get: (): Promise<string | null> =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(KEY) ?? null) : SecureStore.getItemAsync(KEY),
  set: (value: string): Promise<void> =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.setItem(KEY, value)) : SecureStore.setItemAsync(KEY, value),
  remove: (): Promise<void> =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.removeItem(KEY)) : SecureStore.deleteItemAsync(KEY),
};

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await store.get();
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    // Access token hết hạn mà còn refresh token thì vẫn giữ phiên: lần gọi API đầu sẽ đổi token.
    return session.refreshToken || session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): Promise<void> {
  return store.set(JSON.stringify(session));
}

export function clearSession(): Promise<void> {
  return store.remove();
}
