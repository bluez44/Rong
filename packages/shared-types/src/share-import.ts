import type { PlaceCategory } from './place';

/** Nền tảng nguồn của một lượt chia sẻ vào app (F4). */
export type SharePlatform = 'tiktok' | 'youtube' | 'facebook' | 'instagram' | 'web';

export type ShareImportStatus = 'pending' | 'done' | 'failed';

export type ShareImportErrorCode =
  | 'METADATA_UNAVAILABLE'
  | 'AI_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INTERRUPTED';

/** Thẻ nguồn: chỉ metadata công khai để ghi nguồn, không sao chép nội dung (FR-4.5). */
export interface ShareSource {
  platform: SharePlatform;
  url: string | null;
  title: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
}

export type ShareImportOptionRef =
  | { kind: 'catalog'; placeId: string }
  | { kind: 'google'; googlePlaceId: string };

export interface ShareImportOption {
  ref: ShareImportOptionRef;
  /** catalog: tên trong danh mục; google: tên Google lấy trực tiếp (không lưu), có thể null. */
  name: string | null;
  address: string | null;
  regionId: string;
  regionName: string;
}

export type ShareImportConfidence = 'high' | 'low' | 'none';

export interface ShareImportCandidate {
  key: string;
  /** Tên AI trích từ nội dung được chia sẻ. */
  name: string;
  category: PlaceCategory;
  /** Trích đoạn ngắn nhắc tới địa điểm. */
  quote: string;
  confidence: ShareImportConfidence;
  options: ShareImportOption[];
  /** Vùng nội dung nhắc tới (nếu tìm được): gợi ý sẵn khi người dùng tự ghim vị trí. */
  regionHint: { id: string; name: string } | null;
}

export interface ShareImportSummary {
  id: string;
  status: ShareImportStatus;
  source: ShareSource;
  candidateCount: number;
  savedCount: number;
  createdAt: string;
}

export interface ShareImport extends ShareImportSummary {
  errorCode: ShareImportErrorCode | null;
  candidates: ShareImportCandidate[];
}

export interface CreateShareImportRequest {
  url?: string;
  text?: string;
}

export type ShareImportSelection = { candidateKey: string } & ShareImportOptionRef;

export interface SaveShareImportRequest {
  selections: ShareImportSelection[];
}

export interface SaveShareImportResponse {
  saved: number;
}
