const mockGoogle = {
  configure: jest.fn(),
  hasPlayServices: jest.fn(),
  signIn: jest.fn(),
  signOut: jest.fn(),
};
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: mockGoogle,
  isSuccessResponse: (r: { type: string }) => r.type === 'success',
  isErrorWithCode: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  statusCodes: { PLAY_SERVICES_NOT_AVAILABLE: 'PLAY', IN_PROGRESS: 'IN_PROGRESS', SIGN_IN_CANCELLED: 'CANCEL' },
}));
const mockZalo = { login: jest.fn(), logout: jest.fn() };
jest.mock('react-native-zalo-kit', () => ({
  login: (...args: unknown[]) => mockZalo.login(...args),
  logout: () => mockZalo.logout(),
  Constants: { AUTH_VIA_APP_OR_WEB: 'AUTH_VIA_APP_OR_WEB' },
}));
const mockExtra: { zaloAppId: unknown } = { zaloAppId: '123' };
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: mockExtra } } }));

type OAuthModule = typeof import('./oauth');

describe('oauth', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-client';
    mockExtra.zaloAppId = '123';
  });
  // Nạp lại module sau jest.resetModules() để đọc env mới; import tĩnh không làm được.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const load = () => require('./oauth') as OAuthModule;

  it('Google thành công → idToken', async () => {
    mockGoogle.hasPlayServices.mockResolvedValue(true);
    mockGoogle.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'id-tok' } });
    await expect(load().signInWithGoogle()).resolves.toEqual({ kind: 'token', token: 'id-tok' });
    expect(mockGoogle.configure).toHaveBeenCalledWith({ webClientId: 'web-client' });
  });

  it('Google hủy → cancelled', async () => {
    mockGoogle.hasPlayServices.mockResolvedValue(true);
    mockGoogle.signIn.mockResolvedValue({ type: 'cancelled', data: null });
    await expect(load().signInWithGoogle()).resolves.toEqual({ kind: 'cancelled' });
  });

  it('Không có Play Services → unavailable với thông báo tiếng Việt', async () => {
    mockGoogle.hasPlayServices.mockRejectedValue({ code: 'PLAY' });
    await expect(load().signInWithGoogle()).resolves.toEqual({
      kind: 'unavailable',
      message: 'Máy này không hỗ trợ đăng nhập Google.',
    });
  });

  it('Google thành công nhưng không có idToken → unavailable', async () => {
    mockGoogle.hasPlayServices.mockResolvedValue(true);
    mockGoogle.signIn.mockResolvedValue({ type: 'success', data: { idToken: null } });
    expect((await load().signInWithGoogle()).kind).toBe('unavailable');
  });

  it('thiếu Web Client ID → googleAvailable false', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    expect(load().googleAvailable).toBe(false);
  });

  it('ZALO_APP_ID trống: Expo ghi null trong extra thành {} → zaloAvailable vẫn false', () => {
    expect(load().zaloAvailable).toBe(true);
    for (const empty of [{}, null, '', undefined]) {
      mockExtra.zaloAppId = empty;
      jest.resetModules();
      expect(load().zaloAvailable).toBe(false);
    }
  });

  it('Zalo thành công → accessToken, gọi chế độ app hoặc web', async () => {
    mockZalo.login.mockResolvedValue({ accessToken: 'z-tok', refreshToken: 'r', expiresIn: 1, expiresAt: 1 });
    await expect(load().signInWithZalo()).resolves.toEqual({ kind: 'token', token: 'z-tok' });
    expect(mockZalo.login).toHaveBeenCalledWith('AUTH_VIA_APP_OR_WEB');
  });

  it('Zalo hủy (-7008) hoặc bị lần đăng nhập mới thay → cancelled', async () => {
    mockZalo.login.mockRejectedValueOnce({ code: '-7008', message: 'Người dùng quay lại' });
    await expect(load().signInWithZalo()).resolves.toEqual({ kind: 'cancelled' });
    mockZalo.login.mockRejectedValueOnce({ code: 'LOGIN_SUPERSEDED', message: 'replaced' });
    await expect(load().signInWithZalo()).resolves.toEqual({ kind: 'cancelled' });
  });

  it('Zalo lỗi khác hủy → unavailable', async () => {
    mockZalo.login.mockRejectedValue({ code: 'NOT_CONFIGURED', message: 'not configured' });
    expect((await load().signInWithZalo()).kind).toBe('unavailable');
  });

  it('signOutProviders sau khi mở lại app (chưa signIn) vẫn configure Google trước khi signOut', async () => {
    mockGoogle.signOut.mockResolvedValue(null);
    await load().signOutProviders();
    expect(mockGoogle.configure).toHaveBeenCalledWith({ webClientId: 'web-client' });
    expect(mockGoogle.configure.mock.invocationCallOrder[0]).toBeLessThan(
      mockGoogle.signOut.mock.invocationCallOrder[0],
    );
  });

  it('signOutProviders nuốt lỗi', async () => {
    mockGoogle.signOut.mockRejectedValue(new Error('x'));
    mockZalo.logout.mockImplementation(() => {
      throw new Error('y');
    });
    await expect(load().signOutProviders()).resolves.toBeUndefined();
  });
});
