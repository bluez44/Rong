import type {
  CreateUserPlaceRequest,
  CreateUserPlaceResponse,
  GooglePlacePreviewResponse,
  PlaceDetail,
  PlaceNotes,
  ReverseGeocodeResponse,
  SaveGooglePlaceRequest,
  SaveGooglePlaceResponse,
  UpdateUserPlaceRequest,
} from '@rong/shared-types';

import type { Fetcher } from './client';

export const placesApi = (f: Fetcher) => ({
  detail: (id: string) => f<PlaceDetail>(`/places/${id}`),
  updateNotes: (id: string, patch: Partial<PlaceNotes>) =>
    f<PlaceNotes | null>(`/places/${id}/notes`, { method: 'PATCH', body: patch }),
  createUserPlace: (body: CreateUserPlaceRequest) =>
    f<CreateUserPlaceResponse>('/places/user', { method: 'POST', body }),
  updateUserPlace: (id: string, body: UpdateUserPlaceRequest) =>
    f<void>(`/places/user/${id}`, { method: 'PATCH', body }),
  googlePreview: (googlePlaceId: string) =>
    f<GooglePlacePreviewResponse>(`/places/google/${encodeURIComponent(googlePlaceId)}`),
  saveGoogle: (body: SaveGooglePlaceRequest) =>
    f<SaveGooglePlaceResponse>('/places/google', { method: 'POST', body }),
  reverseGeocode: (lat: number, lng: number) =>
    f<ReverseGeocodeResponse>(`/places/reverse-geocode?lat=${lat}&lng=${lng}`),
});
