import type { GooglePlaceHit, PlaceSearchHit, PlaceSearchResponse } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

const DEBOUNCE_MS = 300;
const MAX_QUERY_LENGTH = 100;

type State = {
  /** Câu tìm mà kết quả này thuộc về; khác câu đang gõ thì không được hiển thị. */
  forQuery: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  catalog: PlaceSearchHit[];
  existing: PlaceSearchHit[];
  google: GooglePlaceHit[] | null;
  /** Kết quả hiện tại đã hỏi Google (người dùng bấm Tìm trên Google Maps). */
  searchedOnline: boolean;
  error: ApiError | null;
};

const IDLE: State = { forQuery: '', status: 'idle', catalog: [], existing: [], google: null, searchedOnline: false, error: null };

/**
 * Tìm địa điểm theo tên trong một vùng. Khi gõ chỉ tìm trong danh mục của Rong
 * (debounce); Google chỉ được hỏi khi người dùng chủ động `submit`, vì mỗi lần
 * tính vào hạn mức ngày.
 */
export function usePlaceSearch(regionId: string, query: string) {
  const { authFetch } = useAuth();
  const [state, setState] = useState<State>(IDLE);
  // Chỉ nhận phản hồi của lần gọi mới nhất; lần cũ về muộn thì bỏ.
  const latest = useRef(0);
  const lastOnline = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lần tìm online đang bay (q + online), để bấm Tìm liên tục không tính hạn mức nhiều lần.
  const inflight = useRef<string | null>(null);
  const q = query.trim().slice(0, MAX_QUERY_LENGTH);

  const run = useCallback(
    async (text: string, online: boolean) => {
      const key = `${text}|${online}`;
      if (online && inflight.current === key) return;
      const id = ++latest.current;
      lastOnline.current = online;
      inflight.current = key;
      // Giữ kết quả cũ trong lúc chờ (chỉ khi cùng câu tìm) để danh sách không nháy trắng.
      setState((prev) => ({ ...(prev.forQuery === text ? prev : IDLE), forQuery: text, status: 'loading', error: null }));
      try {
        const params = new URLSearchParams({ q: text });
        if (online) params.set('online', 'true');
        const res = await authFetch<PlaceSearchResponse>(`/regions/${regionId}/places/search?${params}`);
        if (id === latest.current) {
          setState({ forQuery: text, status: 'done', catalog: res.catalog, existing: res.existing, google: res.google, searchedOnline: online, error: null });
        }
      } catch (error) {
        if (id !== latest.current) return;
        const apiError = error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.');
        setState((prev) => ({ ...prev, status: 'error', error: apiError }));
      } finally {
        if (inflight.current === key) inflight.current = null;
      }
    },
    [authFetch, regionId],
  );

  useEffect(() => {
    if (!q) {
      // Bỏ phản hồi còn đang bay; kết quả cũ không hiện vì `forQuery` lệch câu đang gõ.
      latest.current++;
      inflight.current = null;
      return;
    }
    timer.current = setTimeout(() => run(q, false), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, run]);

  // Bấm Tìm/Thử lại trong lúc chờ debounce: hủy lần gõ đang chờ để nó không đè lên.
  const cancelPending = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const submit = useCallback(() => {
    if (!q) return;
    cancelPending();
    run(q, true);
  }, [q, run]);

  const retry = useCallback(() => {
    if (!q) return;
    cancelPending();
    run(q, lastOnline.current);
  }, [q, run]);

  // Kết quả của câu tìm khác câu đang gõ chưa về: coi như đang tải, không hiện dòng cũ.
  const current = q && state.forQuery === q ? state : { ...IDLE, status: q ? ('loading' as const) : ('idle' as const) };
  return { ...current, submit, retry };
}
