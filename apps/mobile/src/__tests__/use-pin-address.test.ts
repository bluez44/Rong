import { act, renderHook } from '@testing-library/react-native';

import { usePinAddress } from '@/hooks/use-pin-address';

const mockAuthFetch = jest.fn();
jest.mock('@/auth/auth-context', () => ({ useAuth: () => ({ authFetch: mockAuthFetch }) }));

const A = { lat: 11.94, lng: 108.44 };
const B = { lat: 11.95, lng: 108.45 };

describe('usePinAddress', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAuthFetch.mockReset().mockResolvedValue({ address: null });
  });
  afterEach(() => jest.useRealTimers());

  it('chỉ gọi sau 1 giây đứng yên; kéo tiếp thì đếm lại', async () => {
    const { result, rerender } = await renderHook(({ c }: { c: { lat: number; lng: number } }) => usePinAddress(c), { initialProps: { c: A } });
    expect(result.current.status).toBe('moving');
    await act(async () => jest.advanceTimersByTime(900));
    await rerender({ c: B });
    await act(async () => jest.advanceTimersByTime(900));
    expect(mockAuthFetch).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(100));
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    expect(mockAuthFetch).toHaveBeenCalledWith(`/places/reverse-geocode?lat=${B.lat}&lng=${B.lng}`);
  });

  it('phản hồi cũ về muộn thì bỏ', async () => {
    let resolveA!: (v: { address: string | null }) => void;
    mockAuthFetch
      .mockImplementationOnce(() => new Promise((r) => (resolveA = r)))
      .mockResolvedValueOnce({ address: 'Địa chỉ B' });
    const { result, rerender } = await renderHook(({ c }: { c: { lat: number; lng: number } }) => usePinAddress(c), { initialProps: { c: A } });
    await act(async () => jest.advanceTimersByTime(1000)); // gửi A, chưa về
    await rerender({ c: B });
    await act(async () => jest.advanceTimersByTime(1000)); // gửi B, về ngay
    await act(async () => resolveA({ address: 'Địa chỉ A' })); // A về muộn
    expect(result.current).toEqual({ status: 'done', address: 'Địa chỉ B' });
  });

  it('lỗi mạng → done, address null (chỉ hiện tọa độ)', async () => {
    mockAuthFetch.mockRejectedValueOnce(new Error('mạng'));
    const { result } = await renderHook(() => usePinAddress(A));
    await act(async () => jest.advanceTimersByTime(1000));
    expect(result.current).toEqual({ status: 'done', address: null });
  });
});
