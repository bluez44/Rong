import type { PlaceCategory } from '@rong/shared-types';

/** Nhãn danh mục theo design system. Thứ tự này là thứ tự hàng chip. */
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

export const CATEGORIES = Object.keys(CATEGORY_LABELS) as PlaceCategory[];

/** Số marker tối đa trên bản đồ: chỉ các điểm cao nhất trong khung nhìn (FR-2.1). */
export const MAX_MAP_MARKERS = 5;
