import type {
  NominatimResult,
  OverpassElement,
} from '../open-data/open-data.types.js';
import { searchKey } from './search-text.js';

/** [nam, tây, bắc, đông] — đúng thứ tự Overpass dùng cho khung bao. */
export type Bbox = [number, number, number, number];

const METERS_PER_DEGREE_LAT = 111_320;

/** Khung vuông bao quanh một vòng tròn bán kính `radiusMeters` (phương án A). */
export function bboxAround(
  lat: number,
  lng: number,
  radiusMeters: number,
): Bbox {
  const dLat = radiusMeters / METERS_PER_DEGREE_LAT;
  const dLng =
    radiusMeters / (METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
}

/** Khung nhỏ nhất chứa tất cả các khung — tỉnh mới từ các tỉnh cũ. */
export function unionBbox(boxes: Bbox[]): Bbox | null {
  if (boxes.length === 0) return null;
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/**
 * Khung quá nhỏ (Nominatim trả về khung gần như một điểm cho node) thì coi như
 * không có khung, để dùng vòng tròn quanh điểm thay vào.
 */
export function isUsableBbox([s, w, n, e]: Bbox): boolean {
  return n - s >= 0.005 && e - w >= 0.005;
}

export function bboxFromNominatim(result: NominatimResult): Bbox | null {
  if (!result.boundingbox) return null;
  const [s, n, w, e] = result.boundingbox.map(Number);
  const box: Bbox = [s, w, n, e];
  return box.every(Number.isFinite) && isUsableBbox(box) ? box : null;
}

/** Chọn relation có tên khớp (bỏ dấu, bỏ tiền tố hành chính) với tên cần tìm. */
export function pickRelation(
  candidates: OverpassElement[],
  name: string,
): OverpassElement | undefined {
  const wanted = searchKey(name);
  return candidates.find((candidate) => {
    const tags = candidate.tags ?? {};
    return [tags['name:vi'], tags.name, tags.official_name]
      .filter((value): value is string => value !== undefined)
      .some((value) => searchKey(value) === wanted);
  });
}
