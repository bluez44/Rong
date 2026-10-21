import type { PlaceDetail } from '@rong/shared-types';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import PlaceDetailScreen from '@/app/(app)/place/[id]';

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

const place = {
  id: 'p1',
  name: 'Hồ Xuân Hương',
  category: 'nature',
  coordinates: null,
  image: null,
  website: null,
  description: null,
  locationSource: 'ai',
  googlePlaceId: null,
  sourceUrl: 'https://maps.google.com/?q=ho',
} as unknown as PlaceDetail;

jest.mock('@/hooks/use-place-detail', () => ({
  usePlaceDetail: () => ({ status: 'done', place, error: null, reload: jest.fn() }),
}));
jest.mock('@/lib/saved-places', () => ({
  useSavedPlaces: () => ({ isSaved: () => true, toggle: jest.fn() }),
}));
jest.mock('@/components/ui/adaptive-image', () => ({ AdaptiveImage: () => null }));
jest.mock('@/components/points-map', () => ({ PointsMap: () => null }));
jest.mock('@/components/google-place-content', () => ({ GooglePlaceContentBlock: () => null }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const wrapper = ({ children }: { children: ReactNode }) => <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>;

describe('chi tiết địa điểm: nút lịch trình', () => {
  it('mở từ màn Vùng: có nút thêm vào lịch trình', async () => {
    mockParams = { id: 'p1', regionId: 'r1', regionName: 'Đà Lạt' };
    await render(<PlaceDetailScreen />, { wrapper });
    expect(screen.getByText('Thêm vào lịch trình')).toBeTruthy();
  });

  it('mở từ "Muốn đi": ẩn nút lịch trình, vẫn bỏ lưu được', async () => {
    mockParams = { id: 'p1', regionId: 'r1', regionName: 'Đà Lạt', from: 'saved' };
    await render(<PlaceDetailScreen />, { wrapper });
    expect(screen.queryByText('Thêm vào lịch trình')).toBeNull();
    expect(screen.getByText('Chỉ đường')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Muốn đi/ })).toBeTruthy();
  });
});
