/**
 * Phân trang theo con trỏ, không theo số trang: danh sách địa điểm sắp theo
 * điểm tổng hợp, mà điểm này đổi theo thời gian, nên OFFSET sẽ làm mục bị lặp
 * hoặc nhảy cóc giữa hai lần tải.
 */
export interface CursorPage<T> {
  items: T[];
  /** null nghĩa là đã hết dữ liệu. */
  nextCursor: string | null;
}

/** Trang địa điểm kèm dòng ghi công nguồn dữ liệu mở (ODbL, CC0). */
export interface AttributedPage<T> extends CursorPage<T> {
  attribution: string;
}
