import type { AuthTokens, RegisterResult, UserProfile } from '@rong/shared-types';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError, apiFetch, type RequestOptions } from '@/lib/api';
import { clearSession, loadSession, saveSession, type Session } from '@/lib/session-storage';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  /** true khi vừa bị đăng xuất vì token hết hạn, để màn đăng nhập giải thích lý do. */
  sessionExpired: boolean;
  register: (input: { email: string; password: string; displayName?: string }) => Promise<RegisterResult>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Gọi API cần đăng nhập. Token bị từ chối (401) thì đăng xuất và báo phiên hết hạn. */
  authFetch: <T>(path: string, options?: Omit<RequestOptions, 'token'>) => Promise<T>;
  /** Đổi tên hiển thị trên server rồi cập nhật phiên đang lưu. */
  updateDisplayName: (displayName: string) => Promise<void>;
  /** F11: xóa tài khoản và toàn bộ dữ liệu, rồi đăng xuất. */
  deleteAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    loadSession().then((stored) => {
      setSession(stored);
      setStatus(stored ? 'signedIn' : 'signedOut');
    });
  }, []);

  const expireSession = useCallback(async () => {
    await clearSession();
    setSession(null);
    setSessionExpired(true);
    setStatus('signedOut');
  }, []);

  // Backend chưa có refresh token: hết hạn access token thì phải đăng nhập lại.
  useEffect(() => {
    if (!session) return;
    const delay = session.expiresAt - Date.now();
    // setTimeout tràn số với độ trễ quá ~24,8 ngày và sẽ chạy ngay lập tức.
    if (delay > 2 ** 31 - 1) return;
    const timer = setTimeout(expireSession, Math.max(delay, 0));
    return () => clearTimeout(timer);
  }, [session, expireSession]);

  const startSession = useCallback(async (tokens: AuthTokens) => {
    const next: Session = {
      accessToken: tokens.accessToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
      user: tokens.user,
    };
    await saveSession(next);
    setSessionExpired(false);
    setSession(next);
    setStatus('signedIn');
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const authFetch = async <T,>(path: string, options?: Omit<RequestOptions, 'token'>) => {
      try {
        return await apiFetch<T>(path, { ...options, token: session?.accessToken });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) await expireSession();
        throw error;
      }
    };
    return {
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
        await clearSession();
        setSession(null);
        setStatus('signedOut');
      },
      authFetch,
      updateDisplayName: async (displayName) => {
        if (!session) return;
        const user = await authFetch<UserProfile>('/users/me', { method: 'PATCH', body: { displayName } });
        const next = { ...session, user };
        await saveSession(next);
        setSession(next);
      },
      deleteAccount: async () => {
        await authFetch<void>('/users/me', { method: 'DELETE' });
        await clearSession();
        setSession(null);
        setStatus('signedOut');
      },
    };
  }, [status, session, sessionExpired, startSession, expireSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth phải được dùng bên trong AuthProvider.');
  return value;
}
