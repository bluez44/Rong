import type { PendingVisitReview, ReviewVisitsRequest } from '@rong/shared-types';

import type { Fetcher } from './client';

export const visitsApi = (f: Fetcher) => ({
  pending: () => f<PendingVisitReview[]>('/visits/pending'),
  review: (body: ReviewVisitsRequest) => f<void>('/visits/review', { method: 'POST', body }),
});
