import type { PlaceListItem } from '@rong/shared-types';
import { render } from '@testing-library/react-native';

import { RegionMap } from '@/components/region-map';
import { MAX_MAP_MARKERS } from '@/constants/places';

/** Nhãn của các marker đang vẽ (mỗi lần render). */
const mockDrawn: string[] = [];

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
  function Marker({ accessibilityLabel }: { accessibilityLabel: string }) {
    mockDrawn.push(accessibilityLabel);
    return null;
  }
  return { __esModule: true, default: MapView, Marker, PROVIDER_GOOGLE: 'google' };
});

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: () => Promise.resolve({ status: 'denied' }),
}));

const place = (n: number) =>
  ({ id: `p${n}`, name: `Nơi ${n}`, category: 'nature', coordinates: { lat: 11.9, lng: 108.4 }, locationSource: 'ai' }) as PlaceListItem;

describe('RegionMap: điểm Muốn đi', () => {
  const props = { bbox: null, center: null, selectedKey: null, onSelect: jest.fn(), bottomInset: 0, topInset: 0 };
  const places = Array.from({ length: MAX_MAP_MARKERS + 3 }, (_, i) => place(i));

  it('luôn có marker, kể cả khi nằm ngoài các điểm xếp hạng cao; không vẽ trùng', async () => {
    mockDrawn.length = 0;
    const pinned = [place(MAX_MAP_MARKERS + 2), place(0)];
    await render(<RegionMap {...props} places={places} pinned={pinned} />);
    const last = mockDrawn.slice(-(MAX_MAP_MARKERS + 1));
    expect(new Set(last).size).toBe(last.length);
    expect(last).toContain(`Nơi ${MAX_MAP_MARKERS + 2}`);
    expect(last).toContain('Nơi 0');
  });
});
