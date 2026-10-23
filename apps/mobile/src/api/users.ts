import type { PlaceCategory, UserProfile } from '@rong/shared-types';

import type { Fetcher } from './client';

export const usersApi = (f: Fetcher) => ({
  update: (body: { displayName: string } | { interests: PlaceCategory[] }) =>
    f<UserProfile>('/users/me', { method: 'PATCH', body }),
  remove: () => f<void>('/users/me', { method: 'DELETE' }),
});
