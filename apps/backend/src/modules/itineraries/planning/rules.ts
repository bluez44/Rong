import type {
  Pace,
  PlaceCategory,
  Transport,
  TravelParty,
} from '@rong/shared-types';

/**
 * Quy tắc xếp lịch theo đối tượng — bảng "Quy tắc theo đối tượng" của PRD F6.
 * Thời gian tính bằng phút kể từ 0h (giờ Việt Nam).
 */
export interface PartyRules {
  /** [ít nhất, nhiều nhất] điểm tham quan mỗi ngày trọn. */
  stopsPerDay: [number, number];
  dayStart: number;
  dayEnd: number;
  /** Chặng di chuyển dài hơn thì cảnh báo. */
  maxLegMinutes: number;
  /** Nghỉ trưa sau bữa trưa; 0 = không. */
  middayRestMinutes: number;
  avoidCategories: PlaceCategory[];
  preferCategories: PlaceCategory[];
  defaultTransport: Transport;
}

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

export const PARTY_RULES: Record<TravelParty, PartyRules> = {
  family_with_kids: {
    stopsPerDay: [3, 4],
    dayStart: h(8),
    dayEnd: h(20),
    maxLegMinutes: 45,
    middayRestMinutes: 150,
    avoidCategories: ['nightlife'],
    preferCategories: ['kids', 'nature'],
    defaultTransport: 'car',
  },
  friends: {
    stopsPerDay: [5, 7],
    dayStart: h(8),
    dayEnd: h(23),
    maxLegMinutes: 90,
    middayRestMinutes: 0,
    avoidCategories: [],
    preferCategories: ['check_in', 'cafe', 'nightlife'],
    defaultTransport: 'motorbike',
  },
  couple: {
    stopsPerDay: [4, 5],
    dayStart: h(8),
    dayEnd: h(22),
    maxLegMinutes: 60,
    middayRestMinutes: 0,
    avoidCategories: [],
    preferCategories: ['check_in', 'nature', 'cafe'],
    defaultTransport: 'motorbike',
  },
  solo: {
    stopsPerDay: [4, 6],
    dayStart: h(8),
    dayEnd: h(22),
    maxLegMinutes: 60,
    middayRestMinutes: 0,
    avoidCategories: [],
    preferCategories: [],
    defaultTransport: 'motorbike',
  },
  with_elderly: {
    stopsPerDay: [3, 4],
    dayStart: h(8),
    dayEnd: h(20),
    maxLegMinutes: 45,
    middayRestMinutes: 90,
    avoidCategories: ['nightlife'],
    preferCategories: ['culture', 'nature'],
    defaultTransport: 'car',
  },
};

/** Số điểm mục tiêu cho một ngày trọn theo nhịp độ. */
export function targetStopsPerDay(rules: PartyRules, pace: Pace): number {
  const [min, max] = rules.stopsPerDay;
  if (pace === 'relaxed') return min;
  if (pace === 'packed') return max;
  return Math.round((min + max) / 2);
}

/** Thời lượng tham quan mặc định theo danh mục, phút. AI có thể điều chỉnh trong giới hạn. */
export const VISIT_MINUTES: Record<PlaceCategory, number> = {
  check_in: 60,
  nature: 120,
  culture: 90,
  kids: 150,
  cafe: 60,
  nightlife: 90,
  food: 60,
  stay: 0,
};

/**
 * Giờ mở cửa giả định khi cả dữ liệu riêng lẫn AI đều không có — để không xếp
 * bảo tàng lúc 21h. null = không giới hạn (điểm ngắm cảnh, ăn uống do bộ xếp bữa lo).
 */
export const TYPICAL_HOURS: Record<PlaceCategory, [number, number] | null> = {
  check_in: null,
  nature: [h(6), h(18)],
  culture: [h(7, 30), h(17, 30)],
  kids: [h(8), h(18)],
  cafe: [h(7), h(22)],
  nightlife: [h(17), h(24)],
  food: null,
  stay: null,
};

export const MIN_VISIT_MINUTES = 20;
export const MAX_VISIT_MINUTES = 240;

export type MealType = 'breakfast' | 'lunch' | 'dinner';

/** Khung giờ bữa ăn mặc định — bảng "Bữa ăn" của PRD F6. */
export const MEALS: Array<{
  type: MealType;
  start: number;
  end: number;
  minutes: number;
}> = [
  { type: 'breakfast', start: h(6, 30), end: h(9), minutes: 45 },
  { type: 'lunch', start: h(11), end: h(13, 30), minutes: 60 },
  { type: 'dinner', start: h(17, 30), end: h(20, 30), minutes: 75 },
];

/** Ứng viên AI được thêm chỉ lấy trong phạm vi này từ nơi ở (PRD F6, mặc định 90 phút). */
export const MAX_MINUTES_FROM_ACCOMMODATION = 90;

/** Độ dài tối đa một chuyến trong MVP (PRD F6). */
export const MAX_TRIP_DAYS = 7;
