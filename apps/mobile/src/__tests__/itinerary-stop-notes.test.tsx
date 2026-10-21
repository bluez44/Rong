import type { ItineraryItem } from '@rong/shared-types';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { TimelineItemCard } from '@/components/itinerary-view/itinerary-view';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/place-notes-sheet', () => ({ PlaceNotesSheet: () => null }));

const notes = { note: 'Đi sớm', openingHours: 'Mo-Su 06:00-09:00', priceMin: 20000, priceMax: 40000 };
const item = {
  id: 'i1',
  kind: 'visit',
  placeId: 'p1',
  place: { name: 'Chè bà Tư', category: 'food', coordinates: { lat: 11.9, lng: 108.4 }, locationSource: 'user', notes },
  dayPart: 'morning',
  order: 0,
  startsAt: '2026-11-01T07:00:00+07:00',
  endsAt: '2026-11-01T08:00:00+07:00',
  isAiSuggested: false,
} as unknown as ItineraryItem;

describe('TimelineItemCard: ghi chú', () => {
  beforeEach(() => jest.mocked(router.push).mockClear());

  it('hiện ghi chú và tóm tắt giờ, giá', async () => {
    await render(<TimelineItemCard item={item} stopIndex={1} />);
    expect(screen.getByText('Đi sớm')).toBeTruthy();
    expect(screen.getByText('06:00–09:00 · 20–40k')).toBeTruthy();
  });

  it('người tạo: có "Sửa ghi chú"', async () => {
    const onEditNotes = jest.fn();
    await render(<TimelineItemCard item={item} stopIndex={1} onEditNotes={onEditNotes} />);
    await fireEvent.press(screen.getByText('Sửa ghi chú'));
    expect(onEditNotes).toHaveBeenCalledWith(item);
  });

  it('người xem khác: không có nút sửa; mở chi tiết kèm ghi chú của người tạo', async () => {
    await render(<TimelineItemCard item={item} stopIndex={1} />);
    expect(screen.queryByText('Sửa ghi chú')).toBeNull();
    await fireEvent.press(screen.getByText('Chè bà Tư'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/place/[id]',
      params: { id: 'p1', name: 'Chè bà Tư', ownerNotes: JSON.stringify(notes) },
    });
  });
});
