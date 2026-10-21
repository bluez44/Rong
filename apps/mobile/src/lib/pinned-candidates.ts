import { useSyncExternalStore } from 'react';

/**
 * Ứng viên của một lượt chia sẻ mà người dùng vừa tự ghim (trong phiên chạy app): màn chia sẻ hiện "Đã ghim ✓" cho
 * thẻ đó thay vì nút "Ghim vị trí". Chỉ giữ trong bộ nhớ, như `trip-draft.ts`.
 */
let pinned: ReadonlyMap<string, ReadonlySet<string>> = new Map();
const listeners = new Set<() => void>();
const EMPTY: ReadonlySet<string> = new Set();

export const pinnedCandidates = {
  mark(shareImportId: string, candidateKey: string) {
    const next = new Map(pinned);
    next.set(shareImportId, new Set([...(pinned.get(shareImportId) ?? []), candidateKey]));
    pinned = next;
    listeners.forEach((listener) => listener());
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePinnedCandidates(shareImportId: string): ReadonlySet<string> {
  const current = useSyncExternalStore(subscribe, () => pinned);
  return current.get(shareImportId) ?? EMPTY;
}
