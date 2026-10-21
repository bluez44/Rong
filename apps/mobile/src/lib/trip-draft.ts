import type { PlaceCategory } from '@rong/shared-types';
import { useSyncExternalStore } from 'react';

/**
 * Địa điểm người dùng gom ở luồng tìm kiếm (F1 bước 6) để đưa vào form tạo
 * lịch trình (F6). Chỉ giữ trong bộ nhớ, một bản nháp cho một vùng: chọn
 * địa điểm ở vùng khác thì bản nháp cũ bị thay.
 */
export type DraftPlace = { id: string; name: string; category: PlaceCategory };

type Draft = {
  regionId: string | null;
  places: DraftPlace[];
  /** Một điểm lưu trú cho cả chuyến (MVP), chọn ở chip "Lưu trú" — FR-2.12. */
  accommodation: DraftPlace | null;
};

/** Giới hạn của backend (`selectedPlaceIds`). */
export const MAX_SELECTED_PLACES = 40;

const EMPTY: Draft = { regionId: null, places: [], accommodation: null };

let draft: Draft = EMPTY;
const listeners = new Set<() => void>();

function set(next: Draft) {
  draft = next;
  listeners.forEach((listener) => listener());
}

function forRegion(regionId: string): Draft {
  return draft.regionId === regionId ? draft : { ...EMPTY, regionId };
}

export const tripDraft = {
  togglePlace(regionId: string, place: DraftPlace) {
    const current = forRegion(regionId);
    const exists = current.places.some((p) => p.id === place.id);
    if (!exists && current.places.length >= MAX_SELECTED_PLACES) return;
    set({ ...current, places: exists ? current.places.filter((p) => p.id !== place.id) : [...current.places, place] });
  },
  /**
   * Thêm nhiều địa điểm (nút "Thêm tất cả" ở màn Vùng), theo thứ tự, bỏ qua địa điểm đã có; dừng khi đủ
   * `MAX_SELECTED_PLACES`. Trả số địa điểm đã thêm.
   */
  addPlaces(regionId: string, places: DraftPlace[]): number {
    const current = forRegion(regionId);
    const have = new Set(current.places.map((p) => p.id));
    const room = MAX_SELECTED_PLACES - current.places.length;
    const added: DraftPlace[] = [];
    for (const place of places) {
      if (added.length >= room) break;
      if (have.has(place.id)) continue;
      have.add(place.id);
      added.push(place);
    }
    set({ ...current, places: [...current.places, ...added] });
    return added.length;
  },
  /** Bỏ nhiều địa điểm khỏi bản nháp; nơi lưu trú giữ nguyên. */
  removePlaces(regionId: string, ids: string[]) {
    const current = forRegion(regionId);
    const drop = new Set(ids);
    set({ ...current, places: current.places.filter((p) => !drop.has(p.id)) });
  },
  /** Chọn lại đúng điểm đang là nơi ở thì bỏ chọn. */
  toggleAccommodation(regionId: string, place: DraftPlace) {
    const current = forRegion(regionId);
    set({ ...current, accommodation: current.accommodation?.id === place.id ? null : place });
  },
  setAccommodation(regionId: string, place: DraftPlace | null) {
    set({ ...forRegion(regionId), accommodation: place });
  },
  /** Thay cả bản nháp, ví dụ từ danh sách "Muốn đi" (FR-9.2). */
  replace(regionId: string, places: DraftPlace[], accommodation: DraftPlace | null) {
    set({ regionId, places: places.slice(0, MAX_SELECTED_PLACES), accommodation });
  },
  clear() {
    set(EMPTY);
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Bản nháp của vùng `regionId`; rỗng nếu bản nháp hiện tại thuộc vùng khác. */
export function useTripDraft(regionId: string | undefined) {
  const current = useSyncExternalStore(subscribe, () => draft);
  if (!regionId || current.regionId !== regionId) return { places: [] as DraftPlace[], accommodation: null };
  return { places: current.places, accommodation: current.accommodation };
}
