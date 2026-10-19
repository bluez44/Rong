import { inviteTokenFromPath } from '@/lib/invite-link';
import { setPendingInvite } from '@/lib/pending-invite';

/**
 * URL mở app từ bên ngoài.
 * - URL do expo-share-intent mở app (F4) không phải một màn: về trang chủ, `useIncomingShare` lo phần còn lại.
 * - Link mời nhóm (`https://<domain>/invite/<t>`, `rong://invite/<t>`): giữ token; màn chấp nhận lời mời mở khi người
 *   dùng đã vào được app (xem `lib/pending-invite.ts`), kể cả khi phải đăng nhập trước. Lúc mở app thì về trang chủ;
 *   lúc app đang chạy thì trả chuỗi rỗng để expo-router không điều hướng gì (không đè lên màn mời, không đẩy người
 *   dùng khỏi màn đăng ký đang dở).
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  if (path.includes('dataUrl=')) return '/';
  const token = inviteTokenFromPath(path);
  if (token) {
    setPendingInvite(token);
    return initial ? '/' : '';
  }
  return path;
}
