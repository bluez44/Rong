/** Mọi query key ở một chỗ, theo cây để invalidate cả nhánh (ví dụ `qk.itineraries.all`). */
export const qk = {
  itineraries: {
    all: ['itineraries'] as const,
    list: () => ['itineraries', 'list'] as const,
    detail: (id: string) => ['itineraries', id] as const,
  },
  places: {
    detail: (id: string) => ['places', id] as const,
    google: (googlePlaceId: string) => ['places', 'google', googlePlaceId] as const,
  },
  regions: {
    search: (q: string, online: boolean) => ['regions', 'search', q, online] as const,
    places: (id: string) => ['regions', id, 'places'] as const,
    placeSearch: (id: string, q: string) => ['regions', id, 'place-search', q] as const,
    weather: (id: string, from: string, to: string) => ['regions', id, 'weather', from, to] as const,
  },
  groups: {
    all: ['groups'] as const,
    detail: (id: string) => ['groups', id] as const,
  },
  savedPlaces: ['saved-places'] as const,
  recommendations: {
    all: ['recommendations'] as const,
    feed: (theme: string) => ['recommendations', 'feed', theme] as const,
  },
  shareImports: {
    all: ['share-imports'] as const,
    detail: (id: string) => ['share-imports', id] as const,
  },
  me: ['users', 'me'] as const,
  pendingVisits: ['visits', 'pending'] as const,
};
