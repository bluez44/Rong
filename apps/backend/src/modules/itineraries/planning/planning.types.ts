import type { PlaceCategory } from '@rong/shared-types';

import type { LatLng } from './travel.js';

/** Một địa điểm trong danh mục có thể đưa vào lịch trình. */
export interface Candidate extends LatLng {
  id: string;
  name: string;
  category: PlaceCategory;
  /** Địa chỉ từ dữ liệu riêng của Rong; không lấy nội dung Google. */
  address?: string | null;
  score: number;
  description: string | null;
  /** Chuỗi opening_hours của OSM, nếu có. */
  openingHours: string | null;
  /** Người dùng đã chọn — bắt buộc phải có trong lịch trình hoặc "Chưa xếp được". */
  mandatory: boolean;
  /** Dòng nguồn Google: tọa độ không được lưu vào lịch trình (PRD 7.4). */
  isGoogle?: boolean;
  /** Tọa độ từ đâu; `ai` là gần đúng (thời gian di chuyển chỉ là ước tính). */
  locationSource?: 'osm' | 'google' | 'ai';
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
