import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/lib/api';

import { OAuthButtons } from './oauth-buttons';

const mockAuth = { loginWithGoogle: jest.fn(), loginWithZalo: jest.fn() };
jest.mock('@/auth/auth-context', () => ({ useAuth: () => mockAuth }));
const mockAvailability = { googleAvailable: true, zaloAvailable: true };
jest.mock('@/lib/oauth', () => {
  class OAuthUnavailableError extends Error {}
  return {
    OAuthUnavailableError,
    get googleAvailable() {
      return mockAvailability.googleAvailable;
    },
    get zaloAvailable() {
      return mockAvailability.zaloAvailable;
    },
  };
});

async function renderButtons() {
  const onError = jest.fn();
  const onBusyChange = jest.fn();
  await render(<OAuthButtons label="HOẶC TIẾP TỤC VỚI" onError={onError} onBusyChange={onBusyChange} />);
  return { onError, onBusyChange };
}

const googleButton = () => screen.getByRole('button', { name: 'Đăng nhập bằng Google' });
const zaloButton = () => screen.getByRole('button', { name: 'Đăng nhập bằng Zalo' });

beforeEach(() => {
  jest.clearAllMocks();
  mockAvailability.googleAvailable = true;
  mockAvailability.zaloAvailable = true;
});

describe('OAuthButtons', () => {
  it('chỉ hiện nút của nhà cung cấp đã cấu hình', async () => {
    mockAvailability.zaloAvailable = false;
    await renderButtons();
    expect(googleButton()).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Đăng nhập bằng Zalo' })).toBeNull();
  });

  it('không nhà cung cấp nào thì ẩn cả khối', async () => {
    mockAvailability.googleAvailable = false;
    mockAvailability.zaloAvailable = false;
    await renderButtons();
    expect(screen.queryByText('HOẶC TIẾP TỤC VỚI')).toBeNull();
  });

  it('đang đăng nhập Google thì nút Zalo bị khóa, chỉ một luồng chạy', async () => {
    let finish!: (v: string) => void;
    mockAuth.loginWithGoogle.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { onBusyChange } = await renderButtons();
    // Không await: lần bấm Google cố tình treo tới khi gọi finish().
    const pressingGoogle = fireEvent.press(googleButton());
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
    await fireEvent.press(zaloButton());
    expect(mockAuth.loginWithZalo).not.toHaveBeenCalled();
    await act(async () => finish('token'));
    await pressingGoogle;
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('hủy thì không báo lỗi; lỗi backend thì báo message', async () => {
    const { onError } = await renderButtons();
    mockAuth.loginWithGoogle.mockResolvedValueOnce('cancelled');
    await fireEvent.press(googleButton());
    expect(onError).toHaveBeenLastCalledWith(null);

    mockAuth.loginWithZalo.mockRejectedValueOnce(new ApiError(502, 'PROVIDER_UNAVAILABLE', 'Zalo đang không phản hồi.'));
    await fireEvent.press(zaloButton());
    expect(onError).toHaveBeenLastCalledWith('Zalo đang không phản hồi.');
  });
});
