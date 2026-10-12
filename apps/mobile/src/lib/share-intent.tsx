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
      .catch((e) =>
        Alert.alert('Chưa nhận được nội dung chia sẻ', e instanceof ApiError ? e.message : 'Thử lại sau nhé.'),
      )
      .finally(() => {
        sending.current = false;
      });
  }, [hasShareIntent, shareIntent, resetShareIntent, authFetch]);
}
