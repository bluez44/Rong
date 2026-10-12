import { router } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

/**
 * Nội dung chia sẻ từ app khác (F4). Chỉ chạy trong nhóm màn đã đăng nhập:
 * chia sẻ lúc chưa đăng nhập thì provider giữ lại, đăng nhập xong mới gửi.
 */
export function useIncomingShare() {
  const { authFetch } = useAuth();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const sending = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || sending.current) return;
    const url = shareIntent.webUrl ?? undefined;
    const text = shareIntent.text ?? undefined;
    resetShareIntent();
    if (!url && !text) return;
    sending.current = true;
    authFetch<{ id: string }>('/share-imports', { method: 'POST', body: { url, text } })
      .then(({ id }) => router.push({ pathname: '/share-import/[id]', params: { id } }))
      // Nội dung chia sẻ đã bị xóa trước khi gửi: muốn thử lại thì phải chia sẻ lại.
      .catch((e) => Alert.alert('Chưa nhận được nội dung chia sẻ', shareErrorMessage(e)))
      .finally(() => {
        sending.current = false;
      });
  }, [hasShareIntent, shareIntent, resetShareIntent, authFetch]);
}

function shareErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.code === 'NETWORK_ERROR') {
    return 'Không kết nối được máy chủ. Kiểm tra mạng rồi chia sẻ lại nhé.';
  }
  return e instanceof ApiError ? e.message : 'Hãy chia sẻ lại nhé.';
}
