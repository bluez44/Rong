import type { PlaceSearchResponse, PlacesPage, RegionSearchResult, RegionWeather } from '@rong/shared-types';

import type { Fetcher } from './client';

function searchParams(q: string, online: boolean): URLSearchParams {
  const params = new URLSearchParams({ q });
  if (online) params.set('online', 'true');
  return params;
}

export const regionsApi = (f: Fetcher) => ({
  /** `online`: hỏi thêm Nominatim, chỉ khi người dùng bấm tìm. */
  search: (q: string, online = false) => f<RegionSearchResult[]>(`/regions/search?${searchParams(q, online)}`),
  places: (regionId: string, categories?: string) => {
    const params = new URLSearchParams();
    if (categories) params.set('categories', categories);
    return f<PlacesPage>(`/regions/${regionId}/places?${params}`);
  },
  /** `online`: tìm Google khi bấm tìm (có giới hạn theo ngày). */
  searchPlaces: (regionId: string, q: string, online = false) =>
    f<PlaceSearchResponse>(`/regions/${regionId}/places/search?${searchParams(q, online)}`),
  weather: (regionId: string, from: string, to: string) =>
    f<RegionWeather>(`/regions/${regionId}/weather?from=${from}&to=${to}`),
});
