import type { GooglePlaceHit, PlaceCategory, SaveGooglePlaceRequest, SaveGooglePlaceResponse } from '@rong/shared-types';
import { useCallback, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

export type PickedPlace = { id: string; name: string; category: PlaceCategory };

/**
 * Biến một kết quả Google thành địa điểm có id để đưa vào lịch trình, không
 * thêm vào "Muốn đi" (`addToSaved: false`). Tên lấy từ kết quả tìm, loại từ
 * gợi ý của Google.
 */
export function useAddGooglePlace(regionId: string) {
  const { authFetch } = useAuth();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const add = useCallback(
    async (hit: GooglePlaceHit): Promise<PickedPlace | null> => {
      if (!hit.name) return null;
      setPending(hit.googlePlaceId);
      setError(null);
      const body: SaveGooglePlaceRequest = {
        googlePlaceId: hit.googlePlaceId,
        name: hit.name,
        category: hit.suggestedCategory,
        regionId,
        addToSaved: false,
      };
      try {
        const res = await authFetch<SaveGooglePlaceResponse>('/places/google', { method: 'POST', body });
        return { id: res.placeId, name: hit.name, category: hit.suggestedCategory };
      } catch (e) {
        setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.'));
        return null;
      } finally {
        setPending(null);
      }
    },
    [authFetch, regionId],
  );

  return { add, pending, error };
}
