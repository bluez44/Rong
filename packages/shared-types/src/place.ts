import type { SharePlatform } from './share-import';

/**
 * Địa điểm — PRD mục 7.2 (Place), F2, F3, F5.
 *
 * QUAN TRỌNG: không lưu rating, số đánh giá, giờ mở cửa, ảnh hay đánh giá lấy
 * từ Google (mục 7.4, nguyên tắc 2). Tên địa điểm lấy từ bài viết (hoặc người
 * dùng đặt); tọa độ Google chỉ giữ ≤ 30 ngày.
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
  /** Địa chỉ từ dữ liệu riêng của Rong; nội dung Google nằm trong GooglePlaceContent. */
  address?: string | null;
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
  /** Địa chỉ từ dữ liệu riêng của Rong; không chứa nội dung địa chỉ lấy từ Google. */
  address: string | null;
  /** Mô tả ngắn từ bài viết, null nếu không có. */
  description: string | null;
  /** Giờ mở cửa thô theo cú pháp opening_hours, ví dụ "07:00-17:00". */
  openingHours: string | null;
  /**
   * Giờ mở cửa hôm nay tính từ `openingHours` theo giờ Việt Nam. null nếu không
   * có giờ; `openNow`/`today` null nếu cú pháp quá phức tạp để đọc chắc chắn.
   */
  hours: { openNow: boolean | null; today: string | null } | null;
  website: string | null;
  /** Link mở địa điểm trên Google Maps. */
  sourceUrl: string;
  /** Tọa độ lấy từ đâu; `ai` là gần đúng ("Vị trí gần đúng"). */
  locationSource: LocationSource;
  /** Các bài viết có nhắc tới địa điểm này (rỗng với địa điểm người dùng thêm). */
  articles: ArticleSource[];
  /** Ảnh từ bài viết, null nếu không bài nào có ảnh khớp địa điểm (và với dòng nguồn Google). */
  image: PlaceImage | null;
  /** Có khi đã ghép được với Google Places. */
  googlePlaceId?: string | null;
}

/** Ảnh lấy từ bài viết (hotlink, không lưu file), kèm bài nguồn để ghi công. */
export interface PlaceImage {
  url: string;
  /** Bài viết chứa ảnh. */
  sourceUrl: string;
}

/** Bài viết trên web mà kết quả AI dựa vào. */
export interface ArticleSource {
  title: string;
  uri: string;
  /** Thời điểm đăng bài (ISO 8601), null nếu trang không ghi. */
  publishedAt: string | null;
}

/**
 * Tọa độ của một địa điểm lấy từ đâu:
 * - `google`: ghép được với Google Places (hạn 30 ngày, PRD 7.4).
 * - `ai`: không tìm thấy trên Google Maps; AI ước đoán từ bài viết — chỉ gần đúng.
 */
export type LocationSource = 'google' | 'ai' | 'user';

/**
 * Ghi chú riêng của một người cho một địa điểm (spec 2026-10-21-user-pinned-places). Giá: VND mỗi người.
 * `openingHours` theo cú pháp opening_hours, ví dụ "Mo-Su 07:00-22:00".
 */
export interface PlaceNotes {
  note: string | null;
  openingHours: string | null;
  priceMin: number | null;
  priceMax: number | null;
}

export interface GoogleAuthorAttribution {
  name: string;
  uri: string | null;
  photoUri: string | null;
}

export interface GoogleReview {
  author: GoogleAuthorAttribution;
  rating: number | null;
  text: string | null;
  /** "2 tuần trước" — do Google trả về theo ngôn ngữ yêu cầu. */
  relativeTime: string | null;
  publishTime: string | null;
  /** Link mở đánh giá gốc trên Google Maps — bắt buộc theo chính sách Places API. */
  googleMapsUri: string | null;
}

export interface GooglePhoto {
  /** URL ảnh ngắn hạn do Google cấp; không lưu lại, không cache. */
  url: string;
  width: number;
  height: number;
  authors: GoogleAuthorAttribution[];
}

/**
 * Nội dung Google Maps cho màn hình chi tiết (F5). Gọi theo thời gian thực mỗi
 * lần mở, không lưu (PRD 7.4). Client phải hiển thị logo/chữ "Google Maps",
 * tách biệt với dữ liệu của app, và ghi tên tác giả ảnh/đánh giá kèm link.
 */
export interface GooglePlaceContent {
  placeId: string;
  /** Tên Google, chỉ hiển thị trực tiếp (không lưu). */
  name: string | null;
  googleMapsUri: string | null;
  address: string | null;
  rating: number | null;
  ratingCount: number | null;
  openNow: boolean | null;
  /** Giờ mở cửa từng ngày do Google định dạng sẵn, ví dụ "Thứ Hai: 07:00 – 22:00". */
  weekdayHours: string[];
  reviews: GoogleReview[];
  photos: GooglePhoto[];
}

/** Kết quả tìm có trong DB (danh sách của vùng, hoặc dòng đã có khớp theo place_id). */
export interface PlaceSearchHit {
  id: string;
  name: string;
  category: PlaceCategory;
  /**
   * Dòng `web`: địa chỉ từ bài viết, null nếu bài không ghi. Dòng nguồn Google
   * (chỉ có trong `existing`): địa chỉ Google lấy trực tiếp trong lượt tìm, không lưu (PRD 7.4).
   */
  address: string | null;
  coordinates: Coordinates | null;
}

/** Kết quả chỉ có trên Google: lấy trực tiếp để hiển thị, không lưu (PRD 7.4). */
export interface GooglePlaceHit {
  googlePlaceId: string;
  name: string | null;
  address: string | null;
  /** Loại gợi ý từ `primaryType` của Google — chỉ để điền sẵn, không lưu. */
  suggestedCategory: PlaceCategory;
}

export interface PlaceSearchResponse {
  catalog: PlaceSearchHit[];
  /** Kết quả Google trùng một địa điểm đã có trong DB, theo thứ tự Google. */
  existing: PlaceSearchHit[];
  /** null: không tìm Google (không bật online, hoặc Google không dùng được). */
  google: GooglePlaceHit[] | null;
}

export interface GooglePlacePreview {
  googlePlaceId: string;
  name: string | null;
  address: string | null;
  coordinates: Coordinates | null;
  suggestedCategory: PlaceCategory;
  google: GooglePlaceContent;
}

/** Địa điểm đã có trong DB thì chỉ trả id để mở chi tiết thường. */
export type GooglePlacePreviewResponse = { placeId: string } | GooglePlacePreview;

export interface SaveGooglePlaceRequest {
  googlePlaceId: string;
  name: string;
  category: PlaceCategory;
  regionId: string;
  /** false: chỉ tạo/lấy địa điểm để đưa vào lịch trình, không thêm vào "Muốn đi". Mặc định true. */
  addToSaved?: boolean;
}

export interface SaveGooglePlaceResponse {
  placeId: string;
}

/**
 * - `ok`: có nội dung Google.
 * - `not_found`: đã ghép nhưng Google không có địa điểm này.
 * - `unavailable`: chưa cấu hình khóa API hoặc Google đang lỗi — thử lại sau.
 */
export type GoogleContentStatus = 'ok' | 'not_found' | 'unavailable';

/** `web`: tổng hợp từ bài viết trên web (AI), định vị bằng Google Places. */
export type PlaceListSource = 'web';

export interface PlacesPage {
  /** `building`: vùng chưa có danh sách và đang tổng hợp — hỏi lại sau vài giây. */
  status: 'ready' | 'building';
  items: PlaceListItem[];
  attribution: string;
  source: PlaceListSource;
  /** Các bài viết mà danh sách dựa vào. */
  sources: ArticleSource[];
}

/** Màn hình chi tiết địa điểm — F5. */
export interface PlaceDetail extends Omit<PlaceListItem, 'id' | 'coordinates'> {
  id: string;
  /**
   * null khi tọa độ Google đã hết hạn (PRD 7.4): màn chi tiết không gọi Google
   * lấy lại, vì địa điểm đã ghép Google chỉ đường bằng `googlePlaceId`.
   */
  coordinates: Coordinates | null;
  attribution: string;
  googleStatus: GoogleContentStatus;
  google: GooglePlaceContent | null;
  /** Ghi chú của chính người xem; null nếu chưa có. */
  notes: PlaceNotes | null;
  /** Điểm tự ghim do chính người xem tạo: được sửa tên, loại, vị trí. */
  createdByMe: boolean;
}

/** Một địa điểm trong danh sách "Muốn đi" — F9. Chỉ địa điểm có trong danh mục (có id). */
export interface SavedPlace {
  placeId: string;
  name: string;
  category: PlaceCategory;
  /** Vùng người dùng đang xem khi lưu; danh sách được nhóm theo vùng này. */
  regionId: string;
  regionName: string;
  savedAt: string;
  /** null khi chưa có tọa độ (dòng Google đã hết hạn 30 ngày): không vẽ lên bản đồ. */
  coordinates: Coordinates | null;
  locationSource: LocationSource;
  /** 'share' từ chia sẻ (F4), 'search' từ ô tìm địa điểm. */
  source: 'manual' | 'share' | 'search';
  /** Ghi chú riêng của người dùng cho điểm này. */
  notes: PlaceNotes | null;
  /** Chỉ khi `source = 'share'` và lượt chia sẻ còn: để ghi nguồn và mở link gốc. */
  shareSource: { platform: SharePlatform; title: string | null; url: string | null } | null;
}

/** `POST /places/user`: tự ghim một địa điểm và lưu vào "Muốn đi". */
export interface CreateUserPlaceRequest {
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  regionId: string;
  address?: string | null;
  notes?: Partial<PlaceNotes>;
  /** Ghim từ màn chia sẻ: tính vào lượt chia sẻ đó. */
  shareImportId?: string;
}

export interface CreateUserPlaceResponse {
  placeId: string;
}

/** `PATCH /places/user/:id`: người tạo sửa điểm tự ghim. */
export interface UpdateUserPlaceRequest {
  name?: string;
  category?: PlaceCategory;
  lat?: number;
  lng?: number;
  address?: string | null;
}

/** `GET /places/reverse-geocode`: null khi không tìm được (app chỉ hiện tọa độ). */
export interface ReverseGeocodeResponse {
  address: string | null;
}
