import type { UserProfile } from '@rong/shared-types';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type Session = {
  accessToken: string;
  /** Mốc hết hạn, ms kể từ epoch. */
  expiresAt: number;
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
    return session.expiresAt > Date.now() ? session : null;
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
