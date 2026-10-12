import type { ShareImport } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

const POLL_MS = 1500;

/** Một lượt chia sẻ (F4); hỏi lại tới khi nhận diện xong hoặc lỗi. */
export function useShareImport(id: string | undefined) {
  const { authFetch } = useAuth();
  const [job, setJob] = useState<ShareImport | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    if (!id) return;
    if (timer.current) clearTimeout(timer.current);
    try {
      const data = await authFetch<ShareImport>(`/share-imports/${id}`);
      if (!alive.current) return;
      setJob(data);
      setError(null);
      if (data.status === 'pending') timer.current = setTimeout(() => loadRef.current(), POLL_MS);
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.'));
    }
  }, [id, authFetch]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    alive.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  return { job, error, reload: load };
}
