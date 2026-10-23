import type {
  CurrentItineraryShareLink,
  Itinerary,
  ItineraryInput,
  ItineraryShareLink,
  ItinerarySummary,
  Pace,
  PlaceAlternative,
  UpdateItineraryRequest,
} from '@rong/shared-types';

import type { Fetcher } from './client';

/** Tạo lịch trình: không gửi `pace` thì backend tự chọn theo đối tượng đi. */
export type CreateItineraryBody = Omit<ItineraryInput, 'pace'> & { pace?: Pace };

export const itinerariesApi = (f: Fetcher) => ({
  list: () => f<ItinerarySummary[]>('/itineraries'),
  get: (id: string) => f<Itinerary>(`/itineraries/${id}`),
  create: (body: CreateItineraryBody) => f<Itinerary>('/itineraries', { method: 'POST', body }),
  update: (id: string, body: UpdateItineraryRequest) => f<Itinerary>(`/itineraries/${id}`, { method: 'PUT', body }),
  remove: (id: string) => f<void>(`/itineraries/${id}`, { method: 'DELETE' }),
  setGroup: (id: string, groupId: string | null) =>
    f<void>(`/itineraries/${id}/group`, { method: 'PATCH', body: { groupId } }),
  alternatives: (id: string, placeId: string) =>
    f<PlaceAlternative[]>(`/itineraries/${id}/alternatives?placeId=${placeId}`),
  shareLink: (id: string) => f<CurrentItineraryShareLink>(`/itineraries/${id}/share-link`),
  /** Lấy hoặc tạo link, không thu hồi link đã gửi. */
  ensureShareLink: (id: string) => f<ItineraryShareLink>(`/itineraries/${id}/share-link`, { method: 'PUT' }),
});
