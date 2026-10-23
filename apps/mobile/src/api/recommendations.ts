import type { Itinerary, ItineraryDraft, PreviewDraftRequest, RecommendationFeed } from '@rong/shared-types';

import type { Fetcher } from './client';

export const recommendationsApi = (f: Fetcher) => ({
  feed: (theme: string, retry = false) => {
    const params = new URLSearchParams({ theme });
    if (retry) params.set('retry', '1');
    return f<RecommendationFeed>(`/recommendations?${params}`);
  },
  draft: (id: string) => f<ItineraryDraft>(`/recommendations/${id}`),
  preview: (id: string, body: PreviewDraftRequest) =>
    f<ItineraryDraft>(`/recommendations/${id}/preview`, { method: 'POST', body }),
  save: (id: string, draftId: string) =>
    f<Itinerary>(`/recommendations/${id}/save`, { method: 'POST', body: { draftId } }),
});
