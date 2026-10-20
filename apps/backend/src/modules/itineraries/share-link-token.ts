import { createHmac } from 'node:crypto';

/**
 * Token của link xem lịch trình = HMAC-SHA256(bí mật, id link), base64url (43
 * ký tự, cùng dạng `newToken`). Database vẫn chỉ lưu SHA-256 của token, nhưng
 * server tính lại được token từ id để trả link đang hiệu lực cho người chia sẻ
 * lần sau. Đổi bí mật thì không lấy lại được link cũ (vẫn mở được cho tới khi
 * bị thay).
 */
export function shareLinkToken(secret: string, linkId: string): string {
  return createHmac('sha256', secret)
    .update(`itinerary-share-link:${linkId}`)
    .digest('base64url');
}
