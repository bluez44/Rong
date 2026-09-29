import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  GoogleAuthorAttribution,
  GooglePlaceContent,
} from '@rong/shared-types';

import type { GoogleConfig } from '../../config/configuration.js';

export const GOOGLE_CONFIG = 'GOOGLE_CONFIG';

/** Số ảnh lấy cho màn hình chi tiết. Mỗi ảnh là một lần gọi tính phí. */
const MAX_PHOTOS = 3;
const MAX_REVIEWS = 5;
/** Nửa cạnh khung tìm quanh tọa độ riêng khi ghép place_id (~250 m). */
const MATCH_BOX_DEGREES = 0.0025;
/** Nới khung bao của vùng khi kiểm tra kết quả Geocoding (~1 km). */
const GEOCODE_BBOX_PADDING_DEG = 0.01;
/**
 * Loại kết quả Geocoding không chỉ tới một địa điểm cụ thể: Geocoding không
 * tìm ra thì hay rơi về tâm phường, quận, thành phố hay giữa một con đường.
 */
const IMPRECISE_GEOCODE_TYPES = new Set([
  'political',
  'country',
  'postal_code',
  'plus_code',
  'route',
]);

interface GeocodeResponse {
  status: string;
  error_message?: string;
  results?: Array<{
    place_id: string;
    types: string[];
    geometry: { location: { lat: number; lng: number } };
  }>;
}

/**
 * Chỉ các trường thật sự hiển thị. Places API tính tiền theo trường yêu cầu,
 * nên field mask là cả chi phí lẫn phạm vi dữ liệu Google đi vào hệ thống.
 */
const DETAILS_FIELDS = [
  'id',
  'formattedAddress',
  'googleMapsUri',
  'rating',
  'userRatingCount',
  'reviews',
  'currentOpeningHours',
  'regularOpeningHours',
  'photos',
].join(',');

export class GoogleUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleUnavailableError';
  }
}

interface RawAuthor {
  displayName?: string;
  uri?: string;
  photoUri?: string;
}

interface RawPlace {
  id: string;
  formattedAddress?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  reviews?: Array<{
    rating?: number;
    text?: { text?: string };
    originalText?: { text?: string };
    relativePublishTimeDescription?: string;
    publishTime?: string;
    googleMapsUri?: string;
    authorAttribution?: RawAuthor;
  }>;
  photos?: Array<{
    name: string;
    widthPx: number;
    heightPx: number;
    authorAttributions?: RawAuthor[];
  }>;
}

/**
 * Cổng duy nhất tới Google Maps Platform (Places API New, Geocoding API) —
 * PRD 7.4. Không module nào khác
 * được gọi Google. Không lưu và không cache gì ngoài place_id (do PlacesService
 * lưu); mọi nội dung khác đi thẳng từ Google ra response.
 */
@Injectable()
export class GooglePlacesService {
  private readonly logger = new Logger(GooglePlacesService.name);

  constructor(@Inject(GOOGLE_CONFIG) private readonly config: GoogleConfig) {}

  get enabled(): boolean {
    return this.config.mapsApiKey !== null;
  }

  /**
   * Tìm place_id của một địa điểm trong danh mục riêng bằng Text Search dạng
   * "IDs Only" (miễn phí): tên + khung nhỏ quanh tọa độ OSM của nó. Không yêu
   * cầu tên hay tọa độ Google, nên không dữ liệu Google nào khác bị lấy về.
   */
  async matchPlaceId(
    name: string,
    lat: number,
    lng: number,
  ): Promise<string | null> {
    const body = await this.request<{ places?: Array<{ id: string }> }>(
      '/places:searchText',
      {
        method: 'POST',
        fieldMask: 'places.id',
        body: {
          textQuery: name,
          languageCode: 'vi',
          regionCode: 'VN',
          pageSize: 1,
          locationRestriction: {
            rectangle: {
              low: {
                latitude: lat - MATCH_BOX_DEGREES,
                longitude: lng - MATCH_BOX_DEGREES,
              },
              high: {
                latitude: lat + MATCH_BOX_DEGREES,
                longitude: lng + MATCH_BOX_DEGREES,
              },
            },
          },
        },
      },
    );
    return body.places?.[0]?.id ?? null;
  }

  /**
   * Tra tọa độ một địa điểm theo tên (+ địa chỉ) bằng Geocoding API, cho API
   * v2. Tọa độ trả về chỉ được đưa thẳng ra response, không lưu hay cache
   * (PRD 7.4); chỉ place_id được phép giữ lại.
   *
   * `bounds` của Geocoding chỉ ưu tiên chứ không giới hạn, và không tìm ra
   * địa điểm thì Geocoding hay trả tâm phường/thành phố — nên kết quả ngoài
   * khung bao hoặc chỉ là đơn vị hành chính, tên đường đều bị bỏ.
   */
  async geocode(
    query: string,
    bbox: [south: number, west: number, north: number, east: number] | null,
  ): Promise<{ placeId: string; lat: number; lng: number } | null> {
    if (this.config.mapsApiKey === null) {
      throw new GoogleUnavailableError('Chưa cấu hình GOOGLE_MAPS_API_KEY.');
    }

    const params = new URLSearchParams({
      address: query,
      language: 'vi',
      region: 'vn',
      components: 'country:VN',
      key: this.config.mapsApiKey,
    });
    if (bbox) params.set('bounds', `${bbox[0]},${bbox[1]}|${bbox[2]},${bbox[3]}`);

    const started = Date.now();
    let body: GeocodeResponse;
    try {
      const response = await fetch(`${this.config.geocodingUrl}?${params}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new GoogleUnavailableError(
          `Geocoding trả về HTTP ${response.status}`,
        );
      }
      body = (await response.json()) as GeocodeResponse;
    } catch (error) {
      // Không log URL: Geocoding API bắt khóa nằm trong query string.
      this.logger.warn(
        `Geocoding "${query}" lỗi sau ${Date.now() - started} ms: ${(error as Error).message}`,
      );
      if (error instanceof GoogleUnavailableError) throw error;
      throw new GoogleUnavailableError(
        `Không gọi được Geocoding: ${(error as Error).message}`,
      );
    }

    if (body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
      this.logger.warn(
        `Geocoding "${query}" → ${body.status} ${body.error_message ?? ''} (${Date.now() - started} ms)`,
      );
      throw new GoogleUnavailableError(`Geocoding trả về ${body.status}`);
    }

    const hit = (body.results ?? []).find(
      (result) =>
        !result.types.some((type) => IMPRECISE_GEOCODE_TYPES.has(type)) &&
        insideBbox(result.geometry.location, bbox),
    );
    this.logger.debug(
      `Geocoding "${query}" → ${hit ? hit.types.join('|') : `không dùng được (${body.status}, ${body.results?.length ?? 0} kết quả)`} trong ${Date.now() - started} ms`,
    );
    return hit
      ? {
          placeId: hit.place_id,
          lat: hit.geometry.location.lat,
          lng: hit.geometry.location.lng,
        }
      : null;
  }

  /** Nội dung cho màn hình chi tiết. Trả về null nếu Google không còn địa điểm này. */
  async details(placeId: string): Promise<GooglePlaceContent | null> {
    let place: RawPlace;
    try {
      place = await this.request<RawPlace>(
        `/places/${encodeURIComponent(placeId)}?languageCode=vi&regionCode=VN`,
        { method: 'GET', fieldMask: DETAILS_FIELDS },
      );
    } catch (error) {
      if (error instanceof GoogleNotFoundError) return null;
      throw error;
    }

    const photos = await Promise.all(
      (place.photos ?? []).slice(0, MAX_PHOTOS).map(async (photo) => {
        try {
          const media = await this.request<{ photoUri?: string }>(
            `/${photo.name}/media?maxWidthPx=1200&skipHttpRedirect=true`,
            { method: 'GET' },
          );
          return media.photoUri
            ? {
                url: media.photoUri,
                width: photo.widthPx,
                height: photo.heightPx,
                authors: (photo.authorAttributions ?? []).map(toAuthor),
              }
            : null;
        } catch (error) {
          this.logger.warn(
            `Không lấy được ảnh ${photo.name}: ${(error as Error).message}`,
          );
          return null;
        }
      }),
    );

    const hours = place.currentOpeningHours ?? place.regularOpeningHours;
    return {
      placeId: place.id,
      googleMapsUri: place.googleMapsUri ?? null,
      address: place.formattedAddress ?? null,
      rating: place.rating ?? null,
      ratingCount: place.userRatingCount ?? null,
      openNow: hours?.openNow ?? null,
      weekdayHours:
        place.regularOpeningHours?.weekdayDescriptions ??
        hours?.weekdayDescriptions ??
        [],
      reviews: (place.reviews ?? []).slice(0, MAX_REVIEWS).map((review) => ({
        author: toAuthor(review.authorAttribution ?? {}),
        rating: review.rating ?? null,
        text: review.text?.text ?? review.originalText?.text ?? null,
        relativeTime: review.relativePublishTimeDescription ?? null,
        publishTime: review.publishTime ?? null,
        googleMapsUri: review.googleMapsUri ?? null,
      })),
      photos: photos.filter((photo) => photo !== null),
    };
  }

  private async request<T>(
    path: string,
    options: { method: 'GET' | 'POST'; fieldMask?: string; body?: unknown },
  ): Promise<T> {
    if (this.config.mapsApiKey === null) {
      throw new GoogleUnavailableError('Chưa cấu hình GOOGLE_MAPS_API_KEY.');
    }

    const headers: Record<string, string> = {
      'X-Goog-Api-Key': this.config.mapsApiKey,
    };
    if (options.fieldMask) headers['X-Goog-FieldMask'] = options.fieldMask;
    if (options.body !== undefined)
      headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`${this.config.placesUrl}${path}`, {
        method: options.method,
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new GoogleUnavailableError(
        `Không gọi được Google: ${(error as Error).message}`,
      );
    }

    if (response.status === 404) throw new GoogleNotFoundError();
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      // Không log khóa API: nó nằm trong header, không nằm trong URL hay body.
      this.logger.warn(
        `Google ${options.method} ${path.split('?')[0]} → ${response.status} ${text.slice(0, 200)}`,
      );
      throw new GoogleUnavailableError(`Google trả về HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}

class GoogleNotFoundError extends Error {}

function insideBbox(
  { lat, lng }: { lat: number; lng: number },
  bbox: [number, number, number, number] | null,
): boolean {
  if (!bbox) return true;
  const [south, west, north, east] = bbox;
  const pad = GEOCODE_BBOX_PADDING_DEG;
  return (
    lat >= south - pad &&
    lat <= north + pad &&
    lng >= west - pad &&
    lng <= east + pad
  );
}

function toAuthor(author: RawAuthor): GoogleAuthorAttribution {
  return {
    name: author.displayName ?? 'Người dùng Google',
    uri: author.uri ?? null,
    photoUri: author.photoUri ?? null,
  };
}
