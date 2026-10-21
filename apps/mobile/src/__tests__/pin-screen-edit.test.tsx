import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import PinPlaceScreen from '@/app/(app)/place/pin';

let mockParams: Record<string, string> = {};
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
const mockAuthFetch = jest.fn();
jest.mock('@/auth/auth-context', () => ({ useAuth: () => ({ authFetch: mockAuthFetch }) }));
jest.mock('@/lib/saved-places', () => ({ useSavedPlaces: () => ({ reload: jest.fn() }) }));
// Bản đồ giả: dừng ngay tại vị trí mở.
jest.mock('@/components/pin-map', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    PinMap: React.forwardRef(function MockPinMap(
      props: { initialRegion: { lat: number; lng: number }; onSettled: (c: { lat: number; lng: number }) => void },
      _ref: unknown,
    ) {
      React.useEffect(() => {
        props.onSettled({ lat: props.initialRegion.lat, lng: props.initialRegion.lng });
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }),
  };
});
// Sheet giả: hiện nội dung khi mở (sheet thật cần SheetHost).
jest.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? children : null),
}));
jest.mock('@expo/ui/community/datetime-picker', () => ({ DateTimePicker: () => null }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
);

describe('màn ghim: sửa điểm đã ghim', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAuthFetch.mockReset();
    mockBack.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('mở từ lịch trình (không có vùng): vẫn lưu được; địa chỉ chưa có thì không ghi đè', async () => {
    mockParams = { editPlaceId: 'p1', name: 'Chè bà Tư', category: 'food', lat: '11.94', lng: '108.44' };
    mockAuthFetch.mockImplementation((url: string) =>
      url.startsWith('/places/reverse-geocode') ? Promise.resolve({ address: null }) : Promise.resolve(undefined),
    );
    await render(<PinPlaceScreen />, { wrapper });
    await act(async () => jest.advanceTimersByTime(1000));

    await fireEvent.press(screen.getByText('Ghim ở đây'));
    await fireEvent.press(screen.getByText('Lưu'));

    expect(mockAuthFetch).toHaveBeenCalledWith('/places/user/p1', {
      method: 'PATCH',
      body: { name: 'Chè bà Tư', category: 'food', lat: 11.94, lng: 108.44 },
    });
    expect(mockBack).toHaveBeenCalled();
  });

  it('địa chỉ đang tải: chưa cho ghim', async () => {
    mockParams = { editPlaceId: 'p1', name: 'Chè bà Tư', category: 'food', lat: '11.94', lng: '108.44' };
    mockAuthFetch.mockImplementation(() => new Promise(() => {}));
    await render(<PinPlaceScreen />, { wrapper });
    await act(async () => jest.advanceTimersByTime(1000));
    expect(screen.getByRole('button', { name: 'Ghim ở đây' })).toBeDisabled();
  });
});
