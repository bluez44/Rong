import type { ShareImportCandidate } from '@rong/shared-types';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ShareCandidateCard } from '@/components/share-candidate-card';
import { pinnedCandidates } from '@/lib/pinned-candidates';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const none: ShareImportCandidate = {
  key: 'c2',
  name: 'Chè bà Tư',
  category: 'food',
  quote: 'ghé Chè bà Tư',
  confidence: 'none',
  options: [],
  regionHint: { id: 'r-dalat', name: 'Đà Lạt' },
};

describe('ShareCandidateCard', () => {
  beforeEach(() => jest.mocked(router.push).mockClear());

  it('không khớp: có nút "Ghim vị trí", mở màn ghim với tên, loại, lượt chia sẻ và vùng gợi ý', async () => {
    await render(<ShareCandidateCard shareImportId="s1" candidate={none} choice={null} onChange={jest.fn()} />);
    await fireEvent.press(screen.getByText('Ghim vị trí'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/place/pin',
      params: {
        name: 'Chè bà Tư',
        category: 'food',
        shareImportId: 's1',
        candidateKey: 'c2',
        hintRegionId: 'r-dalat',
        hintRegionName: 'Đà Lạt',
      },
    });
  });

  it('đã khớp tin cậy cao: không có nút ghim', async () => {
    const high: ShareImportCandidate = {
      ...none,
      confidence: 'high',
      options: [{ ref: { kind: 'catalog', placeId: 'p1' }, name: 'Chè bà Tư', address: null, regionId: 'r', regionName: 'Đà Lạt' }],
    };
    await render(<ShareCandidateCard shareImportId="s1" candidate={high} choice={null} onChange={jest.fn()} />);
    expect(screen.queryByText('Ghim vị trí')).toBeNull();
  });

  it('đã ghim trong phiên: hiện "Đã ghim", không còn nút', async () => {
    await act(() => pinnedCandidates.mark('s9', 'c2'));
    await render(<ShareCandidateCard shareImportId="s9" candidate={none} choice={null} onChange={jest.fn()} />);
    expect(screen.getByText(/Đã ghim/)).toBeTruthy();
    expect(screen.queryByText('Ghim vị trí')).toBeNull();
  });
});
