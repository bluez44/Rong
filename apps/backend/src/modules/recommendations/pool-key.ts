import { createHash } from 'node:crypto';

import type { PlaceCategory, TripParams } from '@rong/shared-types';

/**
 * Khóa tra kho bản nháp dùng chung. Không có số người: bản nháp giống nhau cho
 * 2 hay 5 người lớn; số người nằm ở `user_recommendations.params`.
 */
export function poolKey(k: {
  regionId: string;
  categories: PlaceCategory[];
  trip: TripParams;
  listVersion: Date;
}): string {
  const parts = [
    k.regionId,
    [...new Set(k.categories)].sort().join(','),
    k.trip.daysCount,
    k.trip.travelParty,
    k.trip.pace,
    k.trip.budgetTier,
    k.listVersion.toISOString(),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
