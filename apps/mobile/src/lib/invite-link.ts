/**
 * Link mời nhóm (F10): `https://<domain>/invite/<token>`. Cùng domain với backend, vì backend phục vụ trang dự phòng
 * cho máy chưa cài app và file xác minh Android App Links.
 */

const WEB_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');

export function inviteUrl(token: string): string {
  return `${WEB_BASE_URL}/invite/${token}`;
}

const INVITE_PATH = /(?:^|\/)invite\/([^/?#]+)/;

/**
 * Token trong `/invite/<t>`, `rong://invite/<t>` hay `https://…/invite/<t>` (bỏ query, hash); null nếu không phải link
 * mời.
 */
export function inviteTokenFromPath(path: string): string | null {
  const match = INVITE_PATH.exec(path);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
