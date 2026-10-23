import type {
  CreateShareImportRequest,
  SaveShareImportResponse,
  ShareImport,
  ShareImportSelection,
  ShareImportSummary,
} from '@rong/shared-types';

import type { Fetcher } from './client';

export const shareImportsApi = (f: Fetcher) => ({
  list: () => f<ShareImportSummary[]>('/share-imports'),
  get: (id: string) => f<ShareImport>(`/share-imports/${id}`),
  create: (body: CreateShareImportRequest) => f<{ id: string }>('/share-imports', { method: 'POST', body }),
  save: (id: string, selections: ShareImportSelection[]) =>
    f<SaveShareImportResponse>(`/share-imports/${id}/save`, { method: 'POST', body: { selections } }),
});
