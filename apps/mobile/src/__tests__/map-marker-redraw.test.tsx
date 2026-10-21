import type { PlaceListItem } from '@rong/shared-types';
import { render } from '@testing-library/react-native';

import { PointsMap } from '@/components/points-map';
import { RegionMap } from '@/components/region-map';

/**
 * Trên Android, marker là ảnh chụp lại view và chỉ được chụp lúc marker native vừa tạo; thêm/bỏ nhãn tên bên trong
 * không làm nó chụp lại. Vì vậy marker phải được tạo lại mỗi khi trạng thái chọn của nó đổi.
 */
const mockMounts: string[] = [];
const mockUnmounts: string[] = [];

jest.mock('react-native-maps', () => {
  // jest.mock được đưa lên đầu file, trước các import: factory phải tự require.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const React = require('react');
  const { View } = require('react-native');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const MapView = React.forwardRef(function MockMapView(
    { children }: { children: React.ReactNode },
    ref: React.Ref<unknown>,
  ) {
    React.useImperativeHandle(ref, () => ({ fitToCoordinates: () => {}, animateCamera: () => {} }));
    return <View>{children}</View>;
  });
  function Marker({ accessibilityLabel, children }: { accessibilityLabel: string; children: React.ReactNode }) {
    React.useEffect(() => {
      mockMounts.push(accessibilityLabel);
      return () => {
        mockUnmounts.push(accessibilityLabel);
      };
    }, [accessibilityLabel]);
    return <View>{children}</View>;
  }
  return { __esModule: true, default: MapView, Marker, PROVIDER_GOOGLE: 'google' };
});

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: () => Promise.resolve({ status: 'denied' }),
}));

const place = (n: number) =>
  ({
    id: `p${n}`,
    name: `Nơi ${n}`,
    category: 'nature',
    coordinates: { lat: 11.9 + n / 100, lng: 108.4 },
    locationSource: 'ai',
  }) as PlaceListItem;

beforeEach(() => {
  mockMounts.length = 0;
  mockUnmounts.length = 0;
});

describe('marker được tạo lại khi đổi điểm đang chọn', () => {
  const props = { bbox: null, center: null, onSelect: jest.fn(), bottomInset: 0, topInset: 0 };
  const places = [place(1), place(2), place(3)];

  it('RegionMap: chọn điểm khác thì tạo lại cả marker cũ lẫn marker mới, không đụng marker khác', async () => {
    const view = await render(<RegionMap {...props} places={places} selectedKey="p1" />);
    mockMounts.length = 0;

    await view.rerender(<RegionMap {...props} places={places} selectedKey="p2" />);

    expect(mockUnmounts.sort()).toEqual(['Nơi 1', 'Nơi 2']);
    expect(mockMounts.sort()).toEqual(['Nơi 1', 'Nơi 2']);
  });

  it('RegionMap: chọn lại đúng điểm đang chọn thì không tạo lại gì', async () => {
    const view = await render(<RegionMap {...props} places={places} selectedKey="p1" />);
    mockMounts.length = 0;

    await view.rerender(<RegionMap {...props} places={places} selectedKey="p1" />);

    expect(mockMounts).toEqual([]);
    expect(mockUnmounts).toEqual([]);
  });

  it('PointsMap: bỏ chọn thì tạo lại marker vừa bỏ chọn', async () => {
    const points = [1, 2].map((n) => ({ key: `k${n}`, lat: 11.9, lng: 108.4 + n / 100, icon: 'nature' as const, label: `Điểm ${n}` }));
    const view = await render(<PointsMap points={points} selectedKey="k1" onSelect={jest.fn()} />);
    mockMounts.length = 0;

    await view.rerender(<PointsMap points={points} selectedKey={null} onSelect={jest.fn()} />);

    expect(mockUnmounts).toEqual(['Điểm 1']);
    expect(mockMounts).toEqual(['Điểm 1']);
  });
});
