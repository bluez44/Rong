export const SHARE_IMPORT_CONFIG = 'SHARE_IMPORT_CONFIG';
/** Job chạy lâu hơn thì coi là lỗi (spec §4.7). */
export const JOB_TIMEOUT_MS = 30_000;
/** Job `pending` cũ hơn chừng này lúc khởi động là bị gián đoạn. */
export const INTERRUPTED_AFTER_MS = 2 * 60 * 1000;
/** Ứng viên có tọa độ Google: quá 30 ngày thì xóa (PRD 7.4). */
export const CANDIDATES_TTL_DAYS = 30;
export const LIST_LIMIT = 20;
export const LIST_DAYS = 7;
