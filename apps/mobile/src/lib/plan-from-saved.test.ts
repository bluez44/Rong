import type { SavedPlace } from '@rong/shared-types';
import { renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';

import { planFromSaved } from '@/lib/plan-from-saved';
import { tripDraft, useTripDraft } from '@/lib/trip-draft';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const saved = (id: string, category: SavedPlace['category'], savedAt: string): SavedPlace => ({
  placeId: id,
  name: `Nơi ${id}`,
  category,
  regionId: 'r1',
  regionName: 'Đà Lạt, Lâm Đồng',
  savedAt,
  coordinates: { lat: 11.9, lng: 108.4 },
  locationSource: 'ai',
  source: 'manual',
  shareSource: null,
});

describe('planFromSaved', () => {
  beforeEach(() => {
    tripDraft.clear();
    jest.mocked(router.push).mockClear();
  });

  it('đưa điểm Muốn đi vào bản nháp, điểm lưu trú lưu gần nhất là nơi ở, rồi mở màn Vùng', async () => {
    // Danh sách "Muốn đi" đã xếp mới nhất trước.
    planFromSaved({
      regionId: 'r1',
      regionName: 'Đà Lạt, Lâm Đồng',
      data: [saved('a', 'food', '3'), saved('s2', 'stay', '2'), saved('b', 'nature', '1'), saved('s1', 'stay', '0')],
    });

    const { result } = await renderHook(() => useTripDraft('r1'));
    expect(result.current.places.map((p) => p.id)).toEqual(['a', 'b']);
    expect(result.current.accommodation?.id).toBe('s2');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/region/[id]', params: { id: 'r1', name: 'Đà Lạt, Lâm Đồng' } });
  });
});
