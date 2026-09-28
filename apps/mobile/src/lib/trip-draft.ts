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
  /** Chọn lại đúng điểm đang là nơi ở thì bỏ chọn. */
  toggleAccommodation(regionId: string, place: DraftPlace) {
    const current = forRegion(regionId);
    set({ ...current, accommodation: current.accommodation?.id === place.id ? null : place });
  },
  setAccommodation(regionId: string, place: DraftPlace | null) {
    set({ ...forRegion(regionId), accommodation: place });
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
