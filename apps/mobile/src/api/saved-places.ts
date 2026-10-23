import type { SavedPlace } from '@rong/shared-types';

import type { Fetcher } from './client';

export const savedPlacesApi = (f: Fetcher) => ({
  list: () => f<SavedPlace[]>('/saved-places'),
  add: (placeId: string, regionId: string) =>
    f<void>(`/saved-places/${placeId}`, { method: 'PUT', body: { regionId } }),
  remove: (placeId: string) => f<void>(`/saved-places/${placeId}`, { method: 'DELETE' }),
});
