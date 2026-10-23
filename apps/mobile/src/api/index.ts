import { useMemo } from 'react';

import { useAuth } from '@/auth/auth-context';

import type { Fetcher } from './client';
import { groupsApi } from './groups';
import { invitesApi } from './invites';
import { itinerariesApi } from './itineraries';
import { placesApi } from './places';
import { recommendationsApi } from './recommendations';
import { regionsApi } from './regions';
import { savedPlacesApi } from './saved-places';
import { shareImportsApi } from './share-imports';
import { usersApi } from './users';
import { visitsApi } from './visits';

export function createApi(f: Fetcher) {
  return {
    itineraries: itinerariesApi(f),
    recommendations: recommendationsApi(f),
    visits: visitsApi(f),
    places: placesApi(f),
    regions: regionsApi(f),
    savedPlaces: savedPlacesApi(f),
    groups: groupsApi(f),
    invites: invitesApi(f),
    shareImports: shareImportsApi(f),
    users: usersApi(f),
  };
}

export type Api = ReturnType<typeof createApi>;

/** API của phiên hiện tại: làm mới token và 401 vẫn do `authFetch` lo. */
export function useApi(): Api {
  const { authFetch } = useAuth();
  return useMemo(() => createApi(authFetch), [authFetch]);
}
