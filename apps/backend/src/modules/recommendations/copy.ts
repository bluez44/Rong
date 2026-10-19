import type { PlaceCategory } from '@rong/shared-types';

import { CATEGORY_LABELS } from './themes.js';

export interface RecommendationReason {
  /** Sở thích của người dùng có trong bản nháp. */
  matchedInterests: PlaceCategory[];
  newPlaceCount: number;
  revisit: boolean;
  savedCount: number;
}

/** "Vì bạn thích Cà phê và Thiên nhiên · 8 nơi bạn chưa đến". */
export function reasonText(r: RecommendationReason): string {
  const parts: string[] = [];
  if (r.matchedInterests.length > 0) {
    parts.push(
      `Vì bạn thích ${r.matchedInterests
        .slice(0, 2)
        .map((c) => CATEGORY_LABELS[c])
        .join(' và ')}`,
    );
  }
  parts.push(
    r.revisit
      ? `Quay lại, lần này với ${r.newPlaceCount} nơi mới`
      : `${r.newPlaceCount} nơi bạn chưa đến`,
  );
  if (r.savedCount > 0) parts.push(`${r.savedCount} nơi trong "Muốn đi"`);
  return parts.join(' · ');
}

/** "Đà Lạt · Trốn phố về rừng", hoặc theo 2 danh mục nhiều nhất của bản nháp. */
export function cardTitle(
  regionName: string,
  themeLabel: string | null,
  draftCategories: PlaceCategory[],
): string {
  if (themeLabel) return `${regionName} · ${themeLabel}`;
  const top = draftCategories.slice(0, 2).map((c) => CATEGORY_LABELS[c]);
  if (top.length === 0) return `${regionName} · Khám phá`;
  const text = top.join(' và ');
  return `${regionName} · ${text.charAt(0)}${text.slice(1).toLowerCase()}`;
}
