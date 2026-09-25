import type { PlaceListItem } from '@rong/shared-types';

/** [minLng, minLat, maxLng, maxLat], giống `RegionSearchResult.bbox`. */
export type Bbox = [number, number, number, number];

export type RegionMapProps = {
  /** null thì zoom vừa các địa điểm đã tải. */
  bbox: Bbox | null;
  center: { lat: number; lng: number } | null;
  places: PlaceListItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Phần đáy bị bottom sheet che, để zoom vừa vùng mà không lọt dưới sheet. */
  bottomInset: number;
  topInset: number;
};

/** Khóa ổn định cho cả kết quả dự phòng từ AI (không có id). */
export function placeKey(place: PlaceListItem): string {
  return place.id ?? `${place.name}@${place.coordinates.lat},${place.coordinates.lng}`;
}
