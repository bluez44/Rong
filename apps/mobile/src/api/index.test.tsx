import { renderHook } from '@testing-library/react-native';

import { useApi } from './index';

const mockAuthFetch = jest.fn().mockResolvedValue([]);
jest.mock('@/auth/auth-context', () => ({ useAuth: () => ({ authFetch: mockAuthFetch }) }));

describe('useApi', () => {
  it('dựng các module trên authFetch của phiên, giữ nguyên object giữa các lần render', async () => {
    const { result, rerender } = await renderHook(() => useApi());
    const first = result.current;
    await first.itineraries.list();
    expect(mockAuthFetch).toHaveBeenCalledWith('/itineraries');
    await rerender({});
    expect(result.current).toBe(first);
    expect(Object.keys(first).sort()).toEqual(
      ['groups', 'invites', 'itineraries', 'places', 'recommendations', 'regions', 'savedPlaces', 'shareImports', 'users', 'visits'],
    );
  });
});
