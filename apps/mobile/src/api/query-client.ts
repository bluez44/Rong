import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { toApiError } from './client';

/** Mở lại màn trong khoảng này thì dùng dữ liệu đã có, không gọi lại. */
const STALE_MS = 30_000;
const MAX_RETRIES = 2;

/**
 * Chỉ thử lại khi có thể tự khỏi: mất mạng, hoặc 5xx không có mã của backend (`HTTP_5xx`). 4xx và 5xx có mã riêng
 * (ví dụ `PLACES_UNAVAILABLE`: gọi lại là chạy lại pipeline tốn tiền) có nghĩa với màn hình nên trả ngay.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  const { code } = toApiError(error);
  return code === 'NETWORK_ERROR' || /^HTTP_5\d\d$/.test(code);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: STALE_MS, retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}

/** React Native không có sự kiện focus cửa sổ: app trở lại foreground thì tải lại các query đã cũ. */
export function connectFocusManager(): () => void {
  const subscription = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
  return () => subscription.remove();
}
