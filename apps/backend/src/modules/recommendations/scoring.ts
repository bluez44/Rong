import type { TripParams } from '@rong/shared-types';

import { PARTY_RULES, targetStopsPerDay } from '../itineraries/planning/rules.js';

/** Vùng người dùng đã đến vẫn được gợi ý nhưng xếp thấp hẳn. */
export const REVISIT_FACTOR = 0.3;
/** Vùng vừa gợi ý ở các khung giờ trước: hạ xuống để đỡ lặp. */
export const RECENT_FACTOR = 0.5;
/** Mỗi địa điểm "Muốn đi" chưa đến trong vùng. */
export const SAVED_WEIGHT = 3;

export interface RegionStats {
  regionId: string;
  regionName: string;
  /** Địa điểm chưa đi trong 60 hạng đầu, thuộc danh mục của chủ đề. */
  newPlaces: number;
  /** Địa điểm "Muốn đi" chưa đi trong vùng. */
  savedNew: number;
  visitedAny: boolean;
  recentlyShown: boolean;
  /** `region_place_lists.fetched_at`. */
  listVersion: Date;
}

/** null = loại vì không đủ nơi mới cho cả chuyến. */
export function scoreRegion(s: RegionStats, minNew: number): number | null {
  if (s.newPlaces < minNew) return null;
  let score = s.newPlaces + SAVED_WEIGHT * s.savedNew;
  if (s.visitedAny) score *= REVISIT_FACTOR;
  if (s.recentlyShown) score *= RECENT_FACTOR;
  return score;
}

export function pickRegions(
  stats: RegionStats[],
  minNew: number,
  count = 3,
): Array<RegionStats & { score: number }> {
  return stats
    .map((s) => ({ ...s, score: scoreRegion(s, minNew) }))
    .filter((s): s is RegionStats & { score: number } => s.score !== null)
    .sort(
      (a, b) =>
        b.score - a.score || a.regionName.localeCompare(b.regionName, 'vi'),
    )
    .slice(0, count);
}

/** Số điểm tham quan cả chuyến cần, theo đối tượng và nhịp độ (rules.ts). */
export function minNewPlaces(trip: TripParams): number {
  return (
    targetStopsPerDay(PARTY_RULES[trip.travelParty], trip.pace) *
    trip.daysCount
  );
}
