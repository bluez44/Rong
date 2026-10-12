import type { ShareImportSummary } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';

/** Lượt chia sẻ còn cần người dùng xem: đang nhận diện, hoặc xong mà chưa lưu gì. */
export function useShareImports() {
  const { authFetch } = useAuth();
  const [items, setItems] = useState<ShareImportSummary[]>([]);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const data = await authFetch<ShareImportSummary[]>('/share-imports');
      if (!alive.current) return;
      setItems(data.filter((s) => s.status === 'pending' || (s.status === 'done' && s.candidateCount > 0 && s.savedCount === 0)));
    } catch {
      // Phần phụ của màn "Muốn đi": lỗi thì ẩn đi, không chặn danh sách chính.
      if (alive.current) setItems([]);
    }
  }, [authFetch]);

  useEffect(() => {
    alive.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  return { items, reload };
}
