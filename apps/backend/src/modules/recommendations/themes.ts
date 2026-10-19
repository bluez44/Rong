import type { PlaceCategory } from '@rong/shared-types';

import { PLACE_CATEGORIES } from '../places/entities/place.entity.js';

/** Tên icon có trong `apps/mobile/src/components/ui/icon.tsx`. */
export const THEME_ICONS = [
  'sparkles',
  'forest',
  'sun',
  'cafe',
  'food',
  'culture',
  'nature',
  'kids',
  'nightlife',
  'kayak',
  'motorcycle',
  'explore',
] as const;
export const DEFAULT_THEME_ICON = 'sparkles';

export const MAX_USER_THEMES = 3;
export const USER_THEME_LABEL_MAX = 40;

export interface FixedTheme {
  key: string;
  label: string;
  icon: (typeof THEME_ICONS)[number];
  categories: PlaceCategory[];
  /** Giới hạn vùng (`regions.source_key`); không có = mọi vùng. */
  regionSourceKeys?: string[];
}

/** Chủ đề cố định, theo hàng chip mẫu cũ của trang chủ. */
export const FIXED_THEMES: FixedTheme[] = [
  {
    key: 'tron-pho-ve-rung',
    label: 'Trốn phố về rừng',
    icon: 'forest',
    categories: ['nature', 'check_in'],
    regionSourceKeys: [
      'vn:destination:da-lat',
      'vn:destination:bao-loc',
      'vn:destination:sa-pa',
      'vn:destination:moc-chau',
      'vn:destination:tam-dao',
      'vn:destination:mang-den',
      'vn:destination:phong-nha',
      'vn:destination:ba-vi',
      'vn:destination:mu-cang-chai',
    ],
  },
  {
    key: 'am-thuc-mien-tay',
    label: 'Ẩm thực miền Tây',
    icon: 'food',
    categories: ['food', 'culture', 'nature'],
    regionSourceKeys: [
      'vn:province:can-tho:current',
      'vn:province:vinh-long:current',
      'vn:province:an-giang:current',
      'vn:destination:chau-doc',
      'vn:destination:ha-tien',
    ],
  },
  {
    key: 'bien-vang-hoang-hon',
    label: 'Biển vắng hoàng hôn',
    icon: 'sun',
    categories: ['nature', 'check_in'],
    regionSourceKeys: [
      'vn:destination:vung-tau',
      'vn:destination:phu-quoc',
      'vn:destination:con-dao',
      'vn:destination:nha-trang',
      'vn:destination:quy-nhon',
      'vn:destination:mui-ne-phan-thiet',
      'vn:destination:ly-son',
      'vn:destination:co-to',
      'vn:destination:cat-ba',
    ],
  },
  {
    key: 'ca-phe-hoai-niem',
    label: 'Cà phê hoài niệm',
    icon: 'cafe',
    categories: ['cafe', 'check_in'],
  },
  {
    key: 'lang-nghe-thu-cong',
    label: 'Làng nghề thủ công',
    icon: 'culture',
    categories: ['culture'],
  },
];

/** Vùng nổi bật: danh sách địa điểm được job nền tạo sẵn (PRD §4.1 và vài vùng phổ biến). */
export const FEATURED_REGION_SOURCE_KEYS = [
  'vn:destination:da-lat',
  'vn:destination:vung-tau',
  'vn:destination:phu-quoc',
  'vn:destination:hoi-an',
  'vn:province:da-nang:current',
  'vn:province:ho-chi-minh:current',
  'vn:destination:nha-trang',
  'vn:destination:sa-pa',
  'vn:destination:ha-long',
  'vn:destination:quy-nhon',
];

/** Giống `apps/mobile/src/constants/places.ts`. */
export const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  check_in: 'Check-in',
  food: 'Ăn uống',
  cafe: 'Cà phê',
  nature: 'Thiên nhiên',
  kids: 'Vui chơi cho bé',
  culture: 'Văn hóa – lịch sử',
  nightlife: 'Về đêm',
  stay: 'Lưu trú',
};

/** Chủ đề Gemini trả về, chưa kiểm tra. */
export interface RawTheme {
  label: string;
  icon: string;
  categories: string[];
  regionIds: string[];
}

export interface CleanTheme {
  label: string;
  icon: string;
  categories: PlaceCategory[];
  regionIds: string[];
}

const ALLOWED_CATEGORIES: Set<PlaceCategory> = new Set(
  PLACE_CATEGORIES.filter((c) => c !== 'stay'),
);

/**
 * Chỉ giữ phần dùng được: vùng nằm trong danh sách đã gửi cho Gemini, danh mục
 * có thật (trừ Lưu trú), icon có trong app, nhãn ≤ 40 ký tự. Chủ đề nào mất
 * hết vùng hoặc danh mục thì bỏ.
 */
export function sanitizeThemes(
  raw: RawTheme[],
  allowedRegionIds: Set<string>,
): CleanTheme[] {
  return raw
    .map((t) => ({
      label: t.label.trim().slice(0, USER_THEME_LABEL_MAX).trim(),
      icon: (THEME_ICONS as readonly string[]).includes(t.icon)
        ? t.icon
        : DEFAULT_THEME_ICON,
      categories: [
        ...new Set(
          t.categories.filter((c): c is PlaceCategory =>
            ALLOWED_CATEGORIES.has(c as PlaceCategory),
          ),
        ),
      ],
      regionIds: [...new Set(t.regionIds.filter((id) => allowedRegionIds.has(id)))],
    }))
    .filter((t) => t.label && t.categories.length > 0 && t.regionIds.length > 0)
    .slice(0, MAX_USER_THEMES);
}
