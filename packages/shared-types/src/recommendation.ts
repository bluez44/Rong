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
