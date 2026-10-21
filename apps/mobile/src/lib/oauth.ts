import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import Constants from 'expo-constants';
import { Constants as ZaloConstants, login as zaloLogin, logout as zaloLogout } from 'react-native-zalo-kit';

/**
 * Lấy token từ SDK Google / Zalo để gửi lên backend (spec 2026-10-21-google-zalo-login §3.2).
 * Màn hình không biết gì về SDK: chỉ nhận token, "đã hủy" hoặc lỗi kèm thông báo.
 */
export type OAuthResult =
  | { kind: 'token'; token: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; message: string };

/** Lỗi phía máy (không có Play Services, SDK lỗi) — thông báo đã là tiếng Việt. */
export class OAuthUnavailableError extends Error {}

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
// Chỉ nhận chuỗi khác rỗng: Expo ghi `null` trong `extra` thành `{}` (truthy).
const rawZaloAppId: unknown = Constants.expoConfig?.extra?.zaloAppId;
const ZALO_APP_ID = typeof rawZaloAppId === 'string' && rawZaloAppId !== '' ? rawZaloAppId : null;

export const googleAvailable = GOOGLE_WEB_CLIENT_ID !== '';
export const zaloAvailable = !!ZALO_APP_ID;

/**
 * Lỗi Zalo coi như người dùng tự hủy: -7008 là USER_BACK_ERROR của Zalo SDK Android
 * (react-native-zalo-kit/android/.../ZaloKitModule.kt), LOGIN_SUPERSEDED là bị lần đăng nhập mới thay.
 */
const ZALO_CANCEL_CODES = new Set(['-7008', 'LOGIN_SUPERSEDED']);

let googleConfigured = false;

export async function signInWithGoogle(): Promise<OAuthResult> {
  if (!googleConfigured) {
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
    googleConfigured = true;
  }
  try {
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return { kind: 'cancelled' };
    const idToken = response.data.idToken;
    if (!idToken) return { kind: 'unavailable', message: 'Google không trả thông tin đăng nhập. Thử lại.' };
    return { kind: 'token', token: idToken };
  } catch (error) {
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { kind: 'unavailable', message: 'Máy này không hỗ trợ đăng nhập Google.' };
      }
      if (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === statusCodes.IN_PROGRESS) {
        return { kind: 'cancelled' };
      }
    }
    return { kind: 'unavailable', message: 'Không đăng nhập được bằng Google. Thử lại sau ít phút.' };
  }
}

export async function signInWithZalo(): Promise<OAuthResult> {
  try {
    const { accessToken } = await zaloLogin(ZaloConstants.AUTH_VIA_APP_OR_WEB);
    return accessToken ? { kind: 'token', token: accessToken } : { kind: 'cancelled' };
  } catch (error) {
    const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
    if (ZALO_CANCEL_CODES.has(String(code)) || /cancel|hủy|huỷ/i.test(String(message ?? ''))) {
      return { kind: 'cancelled' };
    }
    return { kind: 'unavailable', message: 'Không đăng nhập được bằng Zalo. Thử lại sau ít phút.' };
  }
}

/** Gọi khi đăng xuất, để lần sau người dùng được chọn lại tài khoản. Không bao giờ ném lỗi. */
export async function signOutProviders(): Promise<void> {
  if (googleAvailable) await GoogleSignin.signOut().catch(() => undefined);
  if (zaloAvailable) {
    try {
      zaloLogout();
    } catch {
      // Chưa đăng nhập Zalo hoặc SDK lỗi: không ảnh hưởng đăng xuất khỏi Rong.
    }
  }
}
