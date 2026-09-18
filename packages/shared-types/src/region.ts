/**
 * Vùng địa lý — PRD mục 7.2 (Region, RegionAlias), FR-1.2 và FR-1.9.
 *
 * Hệ thống có hai loại vùng:
 *  - `administrative`: đơn vị hành chính chính thức, lưu cả hai phiên bản địa
 *    giới (trước và sau đợt sáp nhập có hiệu lực 1/7/2025).
 *  - `destination`: polygon điểm đến du lịch do đội ngũ tự định nghĩa theo cách
 *    người dùng hiểu (Đà Lạt, Vũng Tàu, Hội An...).
 */
export type RegionType = 'administrative' | 'destination';

/** Phiên bản địa giới. Chỉ có ý nghĩa với RegionType 'administrative'. */
export type BoundaryVersion = 'pre_merger' | 'current';

/** Cấp hành chính còn lại sau khi bỏ cấp huyện từ 1/7/2025. */
export type AdministrativeLevel = 'province' | 'ward';

/** GeoJSON polygon. Lưu trong Postgres dưới dạng PostGIS geometry. */
export interface GeoPolygon {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

export interface Region {
  id: string;
  name: string;
  type: RegionType;
  boundaryVersion: BoundaryVersion;
  level?: AdministrativeLevel;
  parentId?: string | null;
  /** Vùng kế nhiệm, ví dụ Bình Thuận (cũ) đến Lâm Đồng (mới). */
  successorRegionId?: string | null;
  /** Mô tả ngắn phần được sáp nhập, hiển thị kèm kết quả tìm kiếm. */
  mergeNote?: string | null;
  polygon: GeoPolygon;
}

/** Bảng bí danh ánh xạ tên cũ hoặc tên quen thuộc sang vùng — FR-1.3. */
export interface RegionAlias {
  alias: string;
  regionId: string;
  /** Ghi chú hiển thị, ví dụ "nay thuộc TP. Hồ Chí Minh". */
  displayNote?: string | null;
}
