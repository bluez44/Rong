import type { PlaceCategory } from '@rong/shared-types';

import type { LatLng } from './travel.js';

/** Một địa điểm trong danh mục có thể đưa vào lịch trình. */
export interface Candidate extends LatLng {
  id: string;
  name: string;
  category: PlaceCategory;
  score: number;
  description: string | null;
  /** Chuỗi opening_hours của OSM, nếu có. */
  openingHours: string | null;
  /** Người dùng đã chọn — bắt buộc phải có trong lịch trình hoặc "Chưa xếp được". */
  mandatory: boolean;
}

/** Một điểm dừng đã được chọn và xếp thứ tự cho một ngày (trước khi tính giờ). */
export interface PlannedStop {
  candidate: Candidate;
  visitMinutes: number;
  reason: string | null;
  /** Giờ mở cửa "HH:mm-HH:mm" do AI tra (Google Maps) khi dữ liệu riêng không có. */
  openingHoursHint: string | null;
  isAiSuggested: boolean;
}
