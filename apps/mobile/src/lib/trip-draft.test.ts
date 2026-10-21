import { act, renderHook } from '@testing-library/react-native';

import { MAX_SELECTED_PLACES, tripDraft, useTripDraft, type DraftPlace } from '@/lib/trip-draft';

const place = (n: number): DraftPlace => ({ id: `p${n}`, name: `Nơi ${n}`, category: 'nature' });

async function draftOf(regionId: string) {
  const { result } = await renderHook(() => useTripDraft(regionId));
  return result.current;
}
const ids = async (regionId = 'r1') => (await draftOf(regionId)).places.map((p) => p.id);

describe('tripDraft.addPlaces / removePlaces', () => {
  beforeEach(() => act(() => tripDraft.clear()));

  it('thêm nhiều địa điểm theo thứ tự, bỏ qua địa điểm đã có', async () => {
    tripDraft.togglePlace('r1', place(2));
    expect(tripDraft.addPlaces('r1', [place(1), place(2), place(3)])).toBe(2);
    expect(await ids()).toEqual(['p2', 'p1', 'p3']);
  });

  it(`dừng ở ${MAX_SELECTED_PLACES} địa điểm và trả số đã thêm`, async () => {
    tripDraft.addPlaces('r1', Array.from({ length: MAX_SELECTED_PLACES - 2 }, (_, i) => place(i)));
    expect(tripDraft.addPlaces('r1', [place(100), place(101), place(102)])).toBe(2);
    const now = await ids();
    expect(now).toHaveLength(MAX_SELECTED_PLACES);
    expect(now).not.toContain('p102');
  });

  it('thêm vào vùng khác thì thay bản nháp cũ', async () => {
    tripDraft.addPlaces('r1', [place(1)]);
    tripDraft.addPlaces('r2', [place(2)]);
    expect(await ids('r1')).toEqual([]);
    expect(await ids('r2')).toEqual(['p2']);
  });

  it('bỏ nhiều địa điểm, giữ phần còn lại và nơi lưu trú', async () => {
    const stay: DraftPlace = { id: 's', name: 'Khách sạn', category: 'stay' };
    tripDraft.addPlaces('r1', [place(1), place(2), place(3)]);
    tripDraft.setAccommodation('r1', stay);
    tripDraft.removePlaces('r1', ['p1', 'p3', 'khong-co']);
    expect(await ids()).toEqual(['p2']);
    expect((await draftOf('r1')).accommodation).toEqual(stay);
  });
});
