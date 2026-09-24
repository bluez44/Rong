import type { PlaceCategory } from '@rong/shared-types';

/**
 * Điểm tổng hợp 0–100 cho địa điểm lấy từ dữ liệu mở, chưa có tín hiệu nào
 * từ người dùng app. Hoàn toàn tất định: cùng dữ liệu vào thì cùng điểm ra.
 *
 * Khi có tín hiệu riêng của app (lưu, thêm vào lịch trình, share-to-app — FR-3),
 * điểm này trở thành một thành phần "mức độ nổi tiếng nền" trong công thức mới.
 *
 *   điểm = nền theo danh mục           (8–30)
 *        + được đánh dấu là điểm du lịch (+10)
 *        + có thực thể Wikidata          (+8)  / bài Wikipedia (+4)
 *        + độ nổi tiếng theo sitelinks   (0–40, logarit: 10 ngôn ngữ ≈ 24, 50 ≈ 39)
 *        + độ đầy đủ thông tin           (0–10)
 */
const CATEGORY_BASE: Record<PlaceCategory, number> = {
  check_in: 30,
  nature: 30,
  culture: 28,
  kids: 26,
  cafe: 15,
  food: 15,
  nightlife: 12,
  stay: 10,
};

const TOURISM_HIGHLIGHT = [
  'attraction',
  'viewpoint',
  'museum',
  'theme_park',
  'zoo',
  'aquarium',
];

const COMPLETENESS_KEYS: string[][] = [
  ['opening_hours'],
  ['website', 'contact:website'],
  ['phone', 'contact:phone'],
  ['image', 'wikimedia_commons'],
  ['name:en'],
];

export interface ScoringInput {
  category: PlaceCategory;
  tags: Record<string, string>;
  wikidataId: string | null;
  sitelinks: number | null;
}

export function scorePlace({
  category,
  tags,
  wikidataId,
  sitelinks,
}: ScoringInput): number {
  let score = CATEGORY_BASE[category];

  if (tags.tourism !== undefined && TOURISM_HIGHLIGHT.includes(tags.tourism))
    score += 10;
  if (wikidataId !== null) score += 8;
  if (tags.wikipedia !== undefined) score += 4;
  if (sitelinks !== null && sitelinks > 0) {
    score += Math.min(40, Math.round(10 * Math.log(1 + sitelinks)));
  }

  const filled = COMPLETENESS_KEYS.filter((keys) =>
    keys.some((key) => tags[key] !== undefined),
  );
  score += Math.min(10, filled.length * 2);

  return Math.max(0, Math.min(100, Math.round(score)));
}
