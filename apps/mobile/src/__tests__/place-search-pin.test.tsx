import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { PlaceSearchResults } from '@/components/place-search-results';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const base = {
  status: 'done' as const,
  catalog: [],
  existing: [],
  google: null,
  searchedOnline: false,
  error: null,
  forQuery: 'chè bà tư',
  submit: jest.fn(),
  retry: jest.fn(),
};

describe('PlaceSearchResults: thêm địa điểm của riêng bạn', () => {
  it('không có kết quả trong Rong: nút mở màn ghim với vùng và tên đang gõ', async () => {
    await render(<PlaceSearchResults search={base} regionId="r1" regionName="Đà Lạt" query="Chè bà Tư" />);
    await fireEvent.press(screen.getByText('Thêm địa điểm của riêng bạn'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/place/pin',
      params: { regionId: 'r1', regionName: 'Đà Lạt', name: 'Chè bà Tư' },
    });
  });

  it('đang tìm: chưa hiện nút', async () => {
    await render(
      <PlaceSearchResults search={{ ...base, status: 'loading' }} regionId="r1" regionName="Đà Lạt" query="Chè" />,
    );
    expect(screen.queryByText('Thêm địa điểm của riêng bạn')).toBeNull();
  });
});
