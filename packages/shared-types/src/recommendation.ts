import type { TripWeatherSummary } from './weather';
import type {
  BudgetTier,
  ItineraryDay,
  ItineraryInput,
  ItineraryWarning,
  Pace,
  TravelParty,
  UnscheduledPlace,
} from './itinerary';
import type { PlaceCategory } from './place';

/** Một địa điểm trong lịch trình đã kết thúc, chờ người dùng xác nhận đã đến chưa. */
export interface PendingVisitPlace {
  placeId: string;
  name: string;
  category: PlaceCategory;
}

/** Lịch trình đã kết thúc mà chưa hỏi "Bạn đã đến những nơi nào?". */
export interface PendingVisitReview {
  itineraryId: string;
  regionName: string;
  endsAt: string;
  places: PendingVisitPlace[];
}

export interface ReviewVisitsRequest {
  itineraryId: string;
  /** Địa điểm đã đến; các địa điểm còn lại của lịch trình coi như không đến. */
  visitedPlaceIds: string[];
}

/** Thông số chuyến đi của một gợi ý: học từ lịch trình cũ, người dùng sửa được khi xem trước. */
export interface TripParams {
  travelParty: TravelParty;
  adults: number;
  children: number;
  pace: Pace;
  budgetTier: BudgetTier;
  /** 1–7 ngày. */
  daysCount: number;
}

export type RecommendationThemeKind = 'default' | 'fixed' | 'personal';

/** Một chip chủ đề trên trang chủ. */
export interface RecommendationTheme {
  /** `default` · `fixed:<key>` · `user:<uuid>` */
  key: string;
  label: string;
  /** Tên icon của app mobile (`IconName`). */
  icon: string;
  /** Tên các vùng của chủ đề riêng, ví dụ "Bến Tre, Vĩnh Long". */
  regionHint: string | null;
  kind: RecommendationThemeKind;
}

/** Ảnh vùng, luôn hiện kèm ghi công. */
export interface RegionImage {
  url: string;
  source: 'unsplash' | 'web';
  author: string | null;
  authorUrl: string | null;
  /** Bài viết chứa ảnh (nguồn `web`). */
  sourceUrl: string | null;
}

export interface RecommendationCard {
  id: string;
  regionId: string;
  regionName: string;
  title: string;
  dayCount: number;
  nightCount: number;
  startsAt: string;
  endsAt: string;
  placeCount: number;
  highlights: string[];
  reason: string;
  /** Vùng người dùng đã từng đến. */
  revisit: boolean;
  image: RegionImage | null;
  /** Chưa có (F7): luôn null, app hiện "Đang cập nhật". */
  estimatedCost: null;
  /** Tóm tắt thời tiết cả chuyến; null khi chưa có dữ liệu (app hiện "Đang cập nhật"). */
  weather: TripWeatherSummary | null;
  savedItineraryId: string | null;
}

export interface RecommendationFeed {
  /** `building`: đang tạo bộ gợi ý, hỏi lại sau vài giây. */
  status: 'ready' | 'building';
  windowStart: string;
  nextRefreshAt: string;
  theme: string;
  themes: RecommendationTheme[];
  items: RecommendationCard[];
}

/** Bản nháp lịch trình của một gợi ý, ngày đã dời sang ngày đi đề xuất. */
export interface ItineraryDraft {
  recommendationId: string;
  draftId: string;
  regionId: string;
  regionName: string;
  params: TripParams;
  input: ItineraryInput;
  days: ItineraryDay[];
  unscheduled: UnscheduledPlace[];
  warnings: ItineraryWarning[];
  tips: string[];
  planner: 'heuristic' | 'ai';
  savedItineraryId: string | null;
}

export interface PreviewDraftRequest extends TripParams {
  /** Ngày đi "YYYY-MM-DD" theo giờ Việt Nam. */
  startDate: string;
}

export interface SaveDraftRequest {
  draftId: string;
  groupId?: string | null;
}
