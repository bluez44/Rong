import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ApiError } from '@/lib/api';

import { AuthProvider, useAuth } from './auth-context';

const mockApiFetch = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, apiFetch: (...args: unknown[]) => mockApiFetch(...args) };
});
jest.mock('@/lib/session-storage', () => ({
  loadSession: jest.fn().mockResolvedValue(null),
  saveSession: jest.fn().mockResolvedValue(undefined),
  clearSession: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/preferences', () => ({ resetInterestsOnSignOut: jest.fn() }));
const mockOauth = {
  signInWithGoogle: jest.fn(),
  signInWithZalo: jest.fn(),
  signOutProviders: jest.fn(),
};
jest.mock('@/lib/oauth', () => {
  class OAuthUnavailableError extends Error {}
  return {
    OAuthUnavailableError,
    signInWithGoogle: () => mockOauth.signInWithGoogle(),
    signInWithZalo: () => mockOauth.signInWithZalo(),
    signOutProviders: () => mockOauth.signOutProviders(),
  };
});

const TOKENS = {
  accessToken: 'a',
  expiresIn: 900,
  refreshToken: 'r',
  user: { id: 'u1', displayName: 'An', email: null, emailVerified: false, createdAt: '', interests: [] },
};

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

async function setup() {
  const hook = await renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.status).toBe('signedOut'));
  return hook;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOauth.signOutProviders.mockResolvedValue(undefined);
});

describe('loginWithGoogle / loginWithZalo', () => {
  it('Google: gửi idToken lên /auth/google rồi vào phiên', async () => {
    mockOauth.signInWithGoogle.mockResolvedValue({ kind: 'token', token: 'id-tok' });
    mockApiFetch.mockResolvedValue(TOKENS);
    const { result } = await setup();
    await act(async () => {
      await expect(result.current.loginWithGoogle()).resolves.toBe('token');
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/auth/google', { method: 'POST', body: { idToken: 'id-tok' } });
    expect(result.current.status).toBe('signedIn');
    expect(result.current.session?.user.id).toBe('u1');
  });

  it('Zalo: gửi accessToken lên /auth/zalo', async () => {
    mockOauth.signInWithZalo.mockResolvedValue({ kind: 'token', token: 'z-tok' });
    mockApiFetch.mockResolvedValue(TOKENS);
    const { result } = await setup();
    await act(async () => {
      await result.current.loginWithZalo();
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/auth/zalo', { method: 'POST', body: { accessToken: 'z-tok' } });
  });

  it('hủy thì không gọi API, vẫn đăng xuất', async () => {
    mockOauth.signInWithGoogle.mockResolvedValue({ kind: 'cancelled' });
    const { result } = await setup();
    await act(async () => {
      await expect(result.current.loginWithGoogle()).resolves.toBe('cancelled');
    });
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(result.current.status).toBe('signedOut');
  });

  it('máy không hỗ trợ → ném lỗi với thông báo', async () => {
    mockOauth.signInWithGoogle.mockResolvedValue({ kind: 'unavailable', message: 'Máy này không hỗ trợ đăng nhập Google.' });
    const { result } = await setup();
    await act(async () => {
      await expect(result.current.loginWithGoogle()).rejects.toThrow('Máy này không hỗ trợ đăng nhập Google.');
    });
  });

  it('backend 401 → ném ApiError, không vào phiên', async () => {
    mockOauth.signInWithGoogle.mockResolvedValue({ kind: 'token', token: 'id-tok' });
    mockApiFetch.mockRejectedValue(new ApiError(401, 'EXTERNAL_TOKEN_INVALID', 'Không xác minh được tài khoản.'));
    const { result } = await setup();
    await act(async () => {
      await expect(result.current.loginWithGoogle()).rejects.toBeInstanceOf(ApiError);
    });
    expect(result.current.status).toBe('signedOut');
  });

  it('xóa tài khoản cũng đăng xuất khỏi Google/Zalo', async () => {
    mockOauth.signInWithGoogle.mockResolvedValue({ kind: 'token', token: 'id-tok' });
    mockApiFetch.mockResolvedValue(TOKENS);
    const { result } = await setup();
    await act(async () => {
      await result.current.loginWithGoogle();
    });
    mockApiFetch.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.deleteAccount();
    });
    expect(mockOauth.signOutProviders).toHaveBeenCalled();
  });

  it('đăng xuất gọi signOutProviders', async () => {
    mockOauth.signInWithGoogle.mockResolvedValue({ kind: 'token', token: 'id-tok' });
    mockApiFetch.mockResolvedValue(TOKENS);
    const { result } = await setup();
    await act(async () => {
      await result.current.loginWithGoogle();
    });
    mockApiFetch.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.signOut();
    });
    expect(mockOauth.signOutProviders).toHaveBeenCalled();
  });
});
