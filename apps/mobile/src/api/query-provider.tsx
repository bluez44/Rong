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
    if (previousUserId.current === userId) return;
    previousUserId.current = userId;
    client.clear();
  }, [client, userId]);

  useEffect(() => connectFocusManager(), []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
