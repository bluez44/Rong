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

let mockPlace = {
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
  notes: null,
  createdByMe: false,
} as unknown as PlaceDetail;
const basePlace = mockPlace;

jest.mock('@/hooks/use-place-detail', () => ({
  usePlaceDetail: () => ({ status: 'done', place: mockPlace, error: null, reload: jest.fn() }),
}));
jest.mock('@/lib/saved-places', () => ({
  useSavedPlaces: () => ({ isSaved: () => true, toggle: jest.fn(), reload: jest.fn() }),
}));
jest.mock('@/auth/auth-context', () => ({ useAuth: () => ({ authFetch: jest.fn() }) }));
jest.mock('@/components/ui/adaptive-image', () => ({ AdaptiveImage: () => null }));
jest.mock('@/components/points-map', () => ({ PointsMap: () => null }));
jest.mock('@/components/place-notes-sheet', () => ({ PlaceNotesSheet: () => null }));
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

describe('chi tiết địa điểm: ghi chú và điểm tự ghim', () => {
  afterEach(() => {
    mockPlace = basePlace;
  });

  it('có ghi chú của mình: thẻ "Ghi chú của bạn" có nút Sửa', async () => {
    mockPlace = { ...basePlace, notes: { note: 'Đi sớm', openingHours: null, priceMin: null, priceMax: null } };
    mockParams = { id: 'p1' };
    await render(<PlaceDetailScreen />, { wrapper });
    expect(screen.getByText('Ghi chú của bạn')).toBeTruthy();
    expect(screen.getByText('Đi sớm')).toBeTruthy();
    expect(screen.getByText('Sửa')).toBeTruthy();
  });

  it('mở từ lịch trình của người khác: ghi chú của người tạo, chỉ đọc', async () => {
    mockParams = {
      id: 'p1',
      ownerNotes: JSON.stringify({ note: 'Của người tạo', openingHours: null, priceMin: null, priceMax: null }),
    };
    await render(<PlaceDetailScreen />, { wrapper });
    expect(screen.getByText('Ghi chú của người tạo lịch trình')).toBeTruthy();
    expect(screen.getByText('Của người tạo')).toBeTruthy();
    expect(screen.queryByText('Sửa')).toBeNull();
  });

  it('điểm tự ghim của mình: nhãn "Vị trí bạn ghim" và nút sửa tên, loại, vị trí', async () => {
    mockPlace = { ...basePlace, locationSource: 'user', createdByMe: true, coordinates: { lat: 11.94, lng: 108.44 } } as PlaceDetail;
    mockParams = { id: 'p1' };
    await render(<PlaceDetailScreen />, { wrapper });
    expect(screen.getByText('Vị trí bạn ghim')).toBeTruthy();
    expect(screen.getByText('Sửa tên, loại, vị trí')).toBeTruthy();
  });
});
