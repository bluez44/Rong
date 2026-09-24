import type { PlaceCategory } from './place';

/**
 * Lịch trình — PRD mục 7.2, F6 (tạo), F7 (chi phí), F8 (chỉnh sửa).
 */
export type PlanningMode = 'ai' | 'manual';

/** Ai đi — quyết định quy tắc xếp lịch (F6, bảng "Quy tắc theo đối tượng"). */
export type TravelParty = 'friends' | 'family_with_kids' | 'couple' | 'solo' | 'with_elderly';

export type BudgetTier = 'budget' | 'moderate' | 'comfortable';

export type Pace = 'relaxed' | 'moderate' | 'packed';

export type Transport = 'motorbike' | 'car' | 'taxi';

export type DayPart = 'morning' | 'noon' | 'afternoon' | 'evening';

export type CostCategory = 'tickets' | 'food' | 'transport' | 'accommodation';

/** Loại mục trong một ngày. */
export type ItineraryItemKind = 'visit' | 'meal' | 'rest';

export type MealType = 'breakfast' | 'lunch' | 'dinner';

/**
 * - `ai`: Gemini sắp xếp, code kiểm tra ràng buộc.
 * - `heuristic`: AI không dùng được, thuật toán tự sắp xếp (gom cụm + gần nhất trước).
 * - `manual`: người dùng tự sắp xếp.
 */
export type PlannerKind = 'ai' | 'heuristic' | 'manual';

/** Mọi con số chi phí đều là một khoảng, đơn vị VNĐ — FR-7.1. */
export interface CostRange {
  minVnd: number;
  maxVnd: number;
}

export interface ItineraryInput {
  regionId: string;
  planningMode: PlanningMode;
  startsAt: string;
  endsAt: string;
  travelParty: TravelParty;
  adults: number;
  children: number;
  /** Địa điểm người dùng đã chọn. Luôn được giữ lại trong kết quả — FR-6.2. */
  selectedPlaceIds: string[];
  /** MVP chỉ hỗ trợ một điểm lưu trú cho cả chuyến. */
  accommodationPlaceId?: string | null;
  allowAiSuggestions: boolean;
  budgetTier: BudgetTier;
  pace: Pace;
  transport?: Transport | null;
  preferredCategories?: PlaceCategory[];
  notes?: string | null;
}

/** Ảnh chụp thông tin địa điểm lúc tạo lịch trình (dữ liệu riêng, không phải Google). */
export interface ItineraryPlaceSnapshot {
  name: string;
  category: string;
  coordinates: { lat: number; lng: number };
}

export interface ItineraryItem {
  id: string;
  kind: ItineraryItemKind;
  /** null với mục nghỉ không gắn địa điểm. */
  placeId: string | null;
  place: ItineraryPlaceSnapshot | null;
  mealType?: MealType | null;
  dayPart: DayPart;
  order: number;
  startsAt: string;
  endsAt: string;
  /** Thời gian di chuyển từ điểm trước đó, phút — ước tính theo quãng đường và phương tiện. */
  travelMinutesFromPrevious?: number | null;
  distanceKmFromPrevious?: number | null;
  estimatedCost?: CostRange | null;
  /** Lý do ngắn do AI viết cho lựa chọn này. */
  reason?: string | null;
  /** Điểm do AI thêm vào chứ không phải người dùng chọn — hiện nhãn "AI gợi ý". */
  isAiSuggested: boolean;
}

export interface ItineraryDay {
  id: string;
  date: string;
  /** Khung giờ của ngày theo thời gian chuyến đi và đối tượng. */
  startsAt: string;
  endsAt: string;
  items: ItineraryItem[];
}

/** Địa điểm đã chọn nhưng không xếp vừa — FR-6.7. */
export interface UnscheduledPlace {
  placeId: string;
  reason: string;
}

/** Cảnh báo, không chặn thao tác — FR-8.6. */
export type ItineraryWarningType =
  | 'place_closed'
  | 'long_travel_leg'
  | 'overloaded_day'
  | 'missing_meal';

export interface ItineraryWarning {
  type: ItineraryWarningType;
  message: string;
  dayId?: string;
  itemId?: string;
}

export interface Itinerary {
  id: string;
  ownerId: string;
  groupId?: string | null;
  regionId: string;
  input: ItineraryInput;
  days: ItineraryDay[];
  unscheduled: UnscheduledPlace[];
  warnings: ItineraryWarning[];
  planner: PlannerKind;
  /** Mẹo chung cho chuyến đi do AI viết. */
  tips: string[];
  /** Tổng cả nhóm. */
  totalCost: CostRange;
  totalCostPerPerson: CostRange;
  costByCategory: Record<CostCategory, CostRange>;
  /** "Ước tính" kèm ngày cập nhật bảng giá — FR-7.4. */
  costNote: string;
  /** Số lần chỉnh sửa bằng AI còn lại — FR-6.5, tối đa 3 lần mỗi lịch trình. */
  aiEditsRemaining: number;
  createdAt: string;
  updatedAt: string;
}

/** Một dòng trong danh sách lịch trình của người dùng. */
export interface ItinerarySummary {
  id: string;
  regionId: string;
  regionName: string;
  startsAt: string;
  endsAt: string;
  planner: PlannerKind;
  dayCount: number;
  createdAt: string;
}
