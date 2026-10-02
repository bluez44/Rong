/** Client tự lưu liên tục (FR-8.9): các lần sửa liền nhau của một người gộp thành một dòng nhật ký. */
export const MERGE_WINDOW_MS = 10 * 60 * 1000;

export interface ActivityKey {
  type: string;
  actorId: string | null;
  itineraryId: string | null;
}

export function shouldMerge(
  last: (ActivityKey & { createdAt: Date }) | undefined,
  next: ActivityKey,
  now: Date,
): boolean {
  return (
    last !== undefined &&
    next.type === 'itinerary_updated' &&
    last.type === 'itinerary_updated' &&
    last.actorId === next.actorId &&
    last.itineraryId === next.itineraryId &&
    now.getTime() - last.createdAt.getTime() < MERGE_WINDOW_MS
  );
}

/**
 * Con trỏ giữ `created_at` dạng chuỗi Postgres (độ chính xác micro giây) cùng
 * id; đổi qua Date của JS sẽ mất phần micro giây và làm lặp hoặc sót dòng.
 */
export interface ActivityCursor {
  t: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeActivityCursor(
  raw: string | undefined,
): ActivityCursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<ActivityCursor>;
    if (
      typeof value.t === 'string' &&
      !Number.isNaN(Date.parse(value.t)) &&
      typeof value.id === 'string' &&
      UUID.test(value.id)
    ) {
      return { t: value.t, id: value.id };
    }
  } catch {
    // Con trỏ hỏng: trả trang đầu.
  }
  return null;
}
