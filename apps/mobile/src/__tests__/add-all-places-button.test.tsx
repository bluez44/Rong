import type { PlaceCategory, PlaceListItem } from '@rong/shared-types';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { AddAllPlacesButton } from '@/components/add-all-places-button';
import { MAX_SELECTED_PLACES, tripDraft } from '@/lib/trip-draft';

const item = (n: number, category: PlaceCategory = 'nature') =>
  ({ id: `p${n}`, name: `Nơi ${n}`, category }) as PlaceListItem;

describe('AddAllPlacesButton', () => {
  beforeEach(async () => {
    await act(() => tripDraft.clear());
    jest.restoreAllMocks();
  });

  it('thêm mọi địa điểm đang hiện, trừ lưu trú', async () => {
    const places = [item(1), item(2, 'food'), item(3, 'stay')];
    await render(<AddAllPlacesButton regionId="r1" places={places} />);
    await fireEvent.press(screen.getByText('Thêm tất cả · 2'));
    expect(screen.getByText('Bỏ tất cả')).toBeTruthy();
  });

  it('chỉ đếm địa điểm chưa chọn', async () => {
    await act(() => tripDraft.togglePlace('r1', { id: 'p1', name: 'Nơi 1', category: 'nature' }));
    await render(<AddAllPlacesButton regionId="r1" places={[item(1), item(2), item(3)]} />);
    expect(screen.getByText('Thêm tất cả · 2')).toBeTruthy();
  });

  it('"Bỏ tất cả" chỉ bỏ các địa điểm đang hiện', async () => {
    await act(() => {
      tripDraft.addPlaces('r1', [
        { id: 'p1', name: 'Nơi 1', category: 'nature' },
        { id: 'p9', name: 'Nơi 9', category: 'food' },
      ]);
    });
    await render(<AddAllPlacesButton regionId="r1" places={[item(1)]} />);
    await fireEvent.press(screen.getByText('Bỏ tất cả'));
    expect(screen.getByText('Thêm tất cả · 1')).toBeTruthy();
    await render(<AddAllPlacesButton regionId="r1" places={[item(9, 'food')]} />);
    expect(screen.getByText('Bỏ tất cả')).toBeTruthy();
  });

  it(`chạm trần ${MAX_SELECTED_PLACES} thì báo đã thêm bao nhiêu`, async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await act(() => {
      tripDraft.addPlaces(
        'r1',
        Array.from({ length: MAX_SELECTED_PLACES - 1 }, (_, i) => ({ id: `x${i}`, name: `X ${i}`, category: 'nature' as const })),
      );
    });
    await render(<AddAllPlacesButton regionId="r1" places={[item(1), item(2), item(3)]} />);
    await fireEvent.press(screen.getByText('Thêm tất cả · 3'));
    expect(alert).toHaveBeenCalledWith('Đã thêm 1 địa điểm', `Lịch trình chọn tối đa ${MAX_SELECTED_PLACES} địa điểm.`);
  });

  it('đã đủ trần thì nút tắt', async () => {
    await act(() => {
      tripDraft.addPlaces(
        'r1',
        Array.from({ length: MAX_SELECTED_PLACES }, (_, i) => ({ id: `x${i}`, name: `X ${i}`, category: 'nature' as const })),
      );
    });
    await render(<AddAllPlacesButton regionId="r1" places={[item(1)]} />);
    expect(screen.getByRole('button', { name: `Đã đủ ${MAX_SELECTED_PLACES} địa điểm` })).toBeDisabled();
  });

  it('không có địa điểm nào để thêm (chỉ lưu trú hoặc rỗng) thì ẩn', async () => {
    await render(<AddAllPlacesButton regionId="r1" places={[item(1, 'stay')]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
