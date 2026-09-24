/**
 * Địa điểm — PRD mục 7.2 (Place), F2, F3, F5.
 *
 * QUAN TRỌNG: không lưu rating, số đánh giá, giờ mở cửa, ảnh hay đánh giá lấy
 * từ Google (mục 7.4, nguyên tắc 2). Tên và tọa độ trong danh mục riêng phải
 * đến từ nguồn không phải Google (OSM, curate).
 */
export type PlaceCategory =
  | 'check_in'
  | 'food'
  | 'cafe'
  | 'nature'
  | 'kids'
  | 'culture'
  | 'nightlife'
  | 'stay';

/** Nhãn phù hợp — FR-2.5. */
export type AudienceTag = 'kids' | 'elderly' | 'large_group' | 'couple';

export type PriceLevel = 'budget' | 'moderate' | 'premium';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Place {
  id: string;
  /**
   * Khóa ghép sang Google Places. Là trường Google DUY NHẤT được lưu vô thời
   * hạn (mục 7.4, nguyên tắc 2).
   */
  googlePlaceId?: string | null;
  name: string;
  /** Tọa độ từ nguồn không phải Google. Dùng để lọc điểm trong polygon — FR-1.10. */
  coordinates: Coordinates;
  category: PlaceCategory;
  /** Gồm cả vùng cũ lẫn vùng mới chứa địa điểm này. */
  regionIds: string[];
  audienceTags: AudienceTag[];
  priceLevel?: PriceLevel | null;
  /** Giá vé, VNĐ. `null` nghĩa là chưa có dữ liệu, hiển thị "Chưa có giá". */
  ticketPriceVnd?: number | null;
  /** Thời lượng tham quan gợi ý, tính bằng phút. */
  suggestedDurationMinutes?: number | null;
  /** Điểm biên tập do đội curate chấm, thang 1–5. */
  editorialScore?: number | null;
  /** Điểm tổng hợp 0–100 — FR-3.1, chỉ tính từ tín hiệu riêng của app. */
  compositeScore: number;
  isTrending: boolean;
  updatedAt: string;
}

/** Một mục trong danh sách địa điểm của vùng (bottom sheet — FR-2.9, FR-2.10). */
export interface PlaceListItem {
  id: string;
  name: string;
  category: PlaceCategory;
  coordinates: Coordinates;
  compositeScore: number;
  /** Mô tả ngắn (Wikidata), null nếu không có. */
  description: string | null;
  /** Chuỗi opening_hours thô theo cú pháp OSM, ví dụ "Mo-Su 07:00-17:00". */
  openingHours: string | null;
  website: string | null;
  wikidataId: string | null;
  /** Link tới bản ghi gốc trên OpenStreetMap — bắt buộc ghi nguồn theo ODbL. */
  sourceUrl: string;
}
