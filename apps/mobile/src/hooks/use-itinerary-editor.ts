import type { Itinerary } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';
import { toRequest } from '@/lib/itinerary-edit';

/** FR-8.8: hoàn tác tối thiểu 10 bước. */
const UNDO_LIMIT = 20;
/** Gom các thao tác liên tiếp vào một lần lưu. */
const SAVE_DELAY_MS = 600;

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * Sửa lịch trình (F8) với tự động lưu (FR-8.9): mỗi thao tác đổi bản cục bộ
 * ngay, rồi gửi cả lịch trình lên `PUT /itineraries/:id`. Server trả bản đã
 * tính lại giờ và cảnh báo; bản đó chỉ thay bản cục bộ khi không có thao tác
 * mới trong lúc chờ, để không làm mất thao tác người dùng vừa làm.
 */
export function useItineraryEditor(loaded: Itinerary | null) {
  const { authFetch } = useAuth();
  const [itinerary, setItinerary] = useState<Itinerary | null>(loaded);
  // Ngăn hoàn tác trong ref để thao tác đọc/ghi ngay; state chỉ để vẽ lại nút.
  const history = useRef<Itinerary[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<ApiError | null>(null);

  const current = useRef<Itinerary | null>(loaded);
  // Tăng mỗi lần sửa; phản hồi của lần lưu cũ hơn thì không thay bản cục bộ.
  const revision = useRef(0);
  const saving = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tải (lại) từ server khi không có thay đổi chưa lưu.
  useEffect(() => {
    if (!loaded || saving.current || timer.current) return;
    current.current = loaded;
    setItinerary(loaded);
  }, [loaded]);

  const saveRef = useRef<() => void>(() => {});

  // Rời màn hình khi còn thay đổi chờ lưu thì gửi ngay, không bỏ.
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      saveRef.current();
    },
    [],
  );

  const set = (next: Itinerary) => {
    current.current = next;
    setItinerary(next);
  };

  const save = useCallback(async () => {
    timer.current = null;
    const snapshot = current.current;
    if (!snapshot) return;
    if (saving.current) {
      again.current = true;
      return;
    }
    saving.current = true;
    setSaveState('saving');
    setError(null);
    const sent = revision.current;
    try {
      const saved = await authFetch<Itinerary>(`/itineraries/${snapshot.id}`, { method: 'PUT', body: toRequest(snapshot) });
      if (revision.current === sent) {
        current.current = saved;
        setItinerary(saved);
      }
      setSaveState(revision.current === sent ? 'saved' : 'pending');
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.'));
      setSaveState('error');
    } finally {
      saving.current = false;
      // Có thao tác mới trong lúc đang lưu: lưu tiếp bản mới nhất.
      if (again.current) {
        again.current = false;
        saveRef.current();
      }
    }
  }, [authFetch]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const schedule = useCallback(() => {
    revision.current++;
    setSaveState('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY_MS);
  }, [save]);

  /** Áp một thao tác sửa; bản trước đó vào ngăn hoàn tác. */
  const apply = useCallback(
    (edit: (itinerary: Itinerary) => Itinerary) => {
      const before = current.current;
      if (!before) return;
      const next = edit(before);
      if (next === before) return;
      history.current = [...history.current.slice(-(UNDO_LIMIT - 1)), before];
      setUndoCount(history.current.length);
      set(next);
      schedule();
    },
    [schedule],
  );

  const undo = useCallback(() => {
    const previous = history.current.at(-1);
    if (!previous) return;
    history.current = history.current.slice(0, -1);
    setUndoCount(history.current.length);
    set(previous);
    schedule();
  }, [schedule]);

  return {
    itinerary,
    apply,
    undo,
    canUndo: undoCount > 0,
    saveState,
    error,
    retry: save,
  };
}
