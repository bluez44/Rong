import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { toApiError } from './client';

/** Mở lại màn trong khoảng này thì dùng dữ liệu đã có, không gọi lại. */
const STALE_MS = 30_000;
const MAX_RETRIES = 2;

/** Chỉ thử lại khi có thể tự khỏi (mất mạng, máy chủ lỗi); 4xx có nghĩa với màn hình nên trả ngay. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  const apiError = toApiError(error);
  return apiError.code === 'NETWORK_ERROR' || apiError.status >= 500;
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
