import type { GroupDetail, InvitePreview } from '@rong/shared-types';

import type { Fetcher } from './client';

export const invitesApi = (f: Fetcher) => ({
  preview: (token: string) => f<InvitePreview>(`/invites/${encodeURIComponent(token)}`),
  accept: (token: string) => f<GroupDetail>(`/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' }),
});
