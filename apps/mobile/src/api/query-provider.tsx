import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/auth/auth-context';

import { connectFocusManager, createQueryClient } from './query-client';

/** Cache gắn với một người dùng: đăng xuất hay đổi tài khoản thì xóa, để người sau không thấy dữ liệu người trước. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  const userId = useAuth().session?.user.id ?? null;
  const previousUserId = useRef(userId);

  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;
    // Chỉ xóa khi rời một người dùng: lúc đăng nhập (null → người dùng) cache đã trống, và effect này chạy sau
    // effect của query con, nên xóa lúc đó sẽ hủy luôn các query đầu tiên của phiên mới.
    if (previous !== null && previous !== userId) client.clear();
  }, [client, userId]);

  useEffect(() => connectFocusManager(), []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
