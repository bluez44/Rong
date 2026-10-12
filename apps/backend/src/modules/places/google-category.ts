import type { PlaceCategory } from '@rong/shared-types';

/**
 * Loại gợi ý từ `primaryType` của Google — chỉ để điền sẵn khi lưu; người dùng
 * xác nhận và chỉ giá trị của Rong được lưu (PRD 7.4). Thứ tự kiểm tra quan
 * trọng: "cafe" trước "restaurant".
 *
 * Khớp theo từ: mỗi mẫu phải nằm trọn giữa đầu/cuối chuỗi hoặc dấu `_`, nên
 * "inn" không khớp "dinner_theater" và "pub" không khớp "public_bath".
 */
const RULES: Array<[PlaceCategory, string[]]> = [
  ['cafe', ['cafe', 'coffee', 'tea_house']],
  ['nightlife', ['bar', 'night_club', 'pub']],
  ['stay', ['lodging', 'hotel', 'hostel', 'resort', 'guest_house', 'motel', 'inn']],
  ['kids', ['amusement_park', 'zoo', 'aquarium', 'water_park', 'playground']],
  [
    'culture',
    [
      'museum',
      'place_of_worship',
      'church',
      'temple',
      'pagoda',
      'mosque',
      'historical',
      'cultural',
      'monument',
    ],
  ],
  ['nature', ['park', 'natural_feature', 'beach', 'hiking', 'garden', 'lake', 'mountain']],
  ['food', ['restaurant', 'food', 'bakery', 'meal', 'bistro', 'diner']],
];

const COMPILED: Array<[PlaceCategory, RegExp]> = RULES.map(([category, terms]) => [
  category,
  new RegExp(`(^|_)(?:${terms.join('|')})(?=_|$)`),
]);

export function categoryFromGoogleType(
  primaryType: string | null | undefined,
): PlaceCategory {
  if (!primaryType) return 'check_in';
  for (const [category, pattern] of COMPILED) {
    if (pattern.test(primaryType)) return category;
  }
  return 'check_in';
}
