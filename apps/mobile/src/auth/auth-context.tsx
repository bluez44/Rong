import type { AuthTokens, RegisterResult, UserProfile } from '@rong/shared-types';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ApiError, apiFetch, type RequestOptions } from '@/lib/api';
import { clearSession, loadSession, saveSession, type Session } from '@/lib/session-storage';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  /** true khi vừa bị đăng xuất vì phiên hết hạn, để màn đăng nhập giải thích lý do. */
  sessionExpired: boolean;
  register: (input: { email: string; password: string; displayName?: string }) => Promise<RegisterResult>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Gọi API cần đăng nhập. Access token sắp hết hạn hoặc bị từ chối (401) thì
   * tự đổi bằng refresh token rồi gọi lại; refresh token cũng bị từ chối thì
   * đăng xuất và báo phiên hết hạn.
   */
  authFetch: <T>(path: string, options?: Omit<RequestOptions, 'token'>) => Promise<T>;
  /** Đổi tên hiển thị trên server rồi cập nhật phiên đang lưu. */
  updateDisplayName: (displayName: string) => Promise<void>;
  /** F11: xóa tài khoản và toàn bộ dữ liệu, rồi đăng xuất. */
  deleteAccount: () => Promise<void>;
};

/** Đổi token trước khi access token hết hạn chừng này, để request không đi với token sắp chết. */
const REFRESH_AHEAD_MS = 30_000;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  // Phiên mới nhất cho các hàm async: state trong closure có thể đã cũ sau một lần đổi token.
  const sessionRef = useRef<Session | null>(null);
  // Lần đổi token đang chạy. Refresh token chỉ dùng được một lần, nên các
  // request cùng gặp 401 phải chờ chung một lần đổi, không tự đổi riêng.
  const refreshing = useRef<Promise<Session | null> | null>(null);

  const applySession = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  useEffect(() => {
    loadSession().then((stored) => {
      applySession(stored);
      setStatus(stored ? 'signedIn' : 'signedOut');
    });
  }, [applySession]);

  const expireSession = useCallback(async () => {
    await clearSession();
    applySession(null);
    setSessionExpired(true);
    setStatus('signedOut');
  }, [applySession]);

  // Phiên lưu từ trước khi có refresh token: hết hạn access token thì phải đăng nhập lại.
  useEffect(() => {
    if (!session || session.refreshToken) return;
    const delay = session.expiresAt - Date.now();
    // setTimeout tràn số với độ trễ quá ~24,8 ngày và sẽ chạy ngay lập tức.
    if (delay > 2 ** 31 - 1) return;
    const timer = setTimeout(expireSession, Math.max(delay, 0));
    return () => clearTimeout(timer);
  }, [session, expireSession]);

  const startSession = useCallback(
    async (tokens: AuthTokens): Promise<Session> => {
      const next: Session = {
        accessToken: tokens.accessToken,
        expiresAt: Date.now() + tokens.expiresIn * 1000,
        refreshToken: tokens.refreshToken,
        user: tokens.user,
      };
      await saveSession(next);
      applySession(next);
      setSessionExpired(false);
      setStatus('signedIn');
      return next;
    },
    [applySession],
  );

  /**
   * Đổi refresh token lấy cặp token mới. Trả về null (và đăng xuất) khi
   * backend từ chối; mất mạng thì ném lỗi và giữ nguyên phiên để thử lại sau.
   */
  const refreshSession = useCallback((): Promise<Session | null> => {
    if (!refreshing.current) {
      refreshing.current = (async () => {
        const refreshToken = sessionRef.current?.refreshToken;
        if (!refreshToken) {
          await expireSession();
          return null;
        }
        try {
          return await startSession(await apiFetch<AuthTokens>('/auth/refresh', { method: 'POST', body: { refreshToken } }));
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            await expireSession();
            return null;
          }
          throw error;
        }
      })().finally(() => {
        refreshing.current = null;
      });
    }
    return refreshing.current;
  }, [expireSession, startSession]);

  const authFetch = useCallback(
    async <T,>(path: string, options?: Omit<RequestOptions, 'token'>): Promise<T> => {
      const sessionExpiredError = () => new ApiError(401, 'SESSION_EXPIRED', 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');

      let current = sessionRef.current;
      if (current?.refreshToken && current.expiresAt - Date.now() < REFRESH_AHEAD_MS) {
        current = await refreshSession();
        if (!current) throw sessionExpiredError();
      }

      try {
        return await apiFetch<T>(path, { ...options, token: current?.accessToken });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        // Token bị từ chối dù chưa tới hạn (đồng hồ máy lệch, khóa ký đổi…): đổi một lần rồi gọi lại.
        const refreshed = current?.refreshToken ? await refreshSession() : (await expireSession(), null);
        if (!refreshed) throw sessionExpiredError();
        return apiFetch<T>(path, { ...options, token: refreshed.accessToken });
      }
    },
    [refreshSession, expireSession],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      sessionExpired,
      register: (input) => apiFetch<RegisterResult>('/auth/register', { method: 'POST', body: input }),
      verifyEmail: async (email, code) => {
        await startSession(await apiFetch<AuthTokens>('/auth/verify-email', { method: 'POST', body: { email, code } }));
      },
      resendVerification: (email) => apiFetch<void>('/auth/resend-verification', { method: 'POST', body: { email } }),
      login: async (email, password) => {
        await startSession(await apiFetch<AuthTokens>('/auth/login', { method: 'POST', body: { email, password } }));
      },
      signOut: async () => {
        const refreshToken = sessionRef.current?.refreshToken;
        await clearSession();
        applySession(null);
        setStatus('signedOut');
        // Thu hồi refresh token trên server; mất mạng thì thôi, token tự hết hạn sau 60 ngày.
        if (refreshToken) {
          apiFetch<void>('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => undefined);
        }
      },
      authFetch,
      updateDisplayName: async (displayName) => {
        const user = await authFetch<UserProfile>('/users/me', { method: 'PATCH', body: { displayName } });
        const current = sessionRef.current;
        if (!current) return;
        const next = { ...current, user };
        await saveSession(next);
        applySession(next);
      },
      deleteAccount: async () => {
        // Refresh token bị xóa theo tài khoản trên server.
        await authFetch<void>('/users/me', { method: 'DELETE' });
        await clearSession();
        applySession(null);
        setStatus('signedOut');
      },
    }),
    [status, session, sessionExpired, startSession, applySession, authFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth phải được dùng bên trong AuthProvider.');
  return value;
}
