import type { PlaceCategory } from '@rong/shared-types';

import type { GoogleCandidate } from '../google/google-places.service.js';
import { foldText } from '../regions/search-text.js';
import { categoryFromGoogleType } from './google-category.js';

/** Độ giống tên tối thiểu để nhận một kết quả Google; chỉnh theo `pnpm bench:places`. */
export const MATCH_MIN_SIMILARITY = 0.5;

/**
 * Độ giống tên 0–1: bỏ dấu, chữ thường; một tên chứa trọn tên kia (theo từ)
 * thì 1 ("Quán cơm Linh" ~ "Quán cơm Linh Đà Lạt"); còn lại hệ số Dice trên
 * cặp ký tự.
 */
export function nameSimilarity(a: string, b: string): number {
  const x = foldText(a);
  const y = foldText(b);
  if (!x || !y) return 0;
  if (x === y || ` ${y} `.includes(` ${x} `) || ` ${x} `.includes(` ${y} `)) return 1;
  const pairs = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const p = s.slice(i, i + 2);
      out.set(p, (out.get(p) ?? 0) + 1);
    }
    return out;
  };
  const px = pairs(x);
  const py = pairs(y);
  let common = 0;
  for (const [p, n] of px) common += Math.min(n, py.get(p) ?? 0);
  return (2 * common) / (x.length - 1 + (y.length - 1));
}

/**
 * Loại Google có mâu thuẫn với danh mục AI trích từ bài viết không. Chỉ loại
 * những cặp chắc chắn sai: lưu trú ↔ không lưu trú, ăn uống/cà phê ↔ tham quan.
 * Loại Google không suy ra được gì (`check_in`) thì không mâu thuẫn.
 */
function conflicts(category: PlaceCategory, primaryType: string | null): boolean {
  const google = categoryFromGoogleType(primaryType);
  if ((category === 'stay') !== (google === 'stay')) return true;
  if (google === 'check_in') return false;
  const eating = (c: PlaceCategory) => c === 'food' || c === 'cafe' || c === 'nightlife';
  return eating(category) !== eating(google);
}

/** Kết quả Google đầu tiên (theo thứ tự Google) đủ giống tên và không mâu thuẫn loại. */
export function pickGoogleMatch(
  name: string,
  category: PlaceCategory,
  candidates: GoogleCandidate[],
  minSimilarity = MATCH_MIN_SIMILARITY,
): GoogleCandidate | null {
  return (
    candidates.find(
      (c) =>
        c.name !== null &&
        nameSimilarity(name, c.name) >= minSimilarity &&
        !conflicts(category, c.primaryType),
    ) ?? null
  );
}
