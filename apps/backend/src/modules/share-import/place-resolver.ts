import type { PlaceCategory } from '@rong/shared-types';

import type { GoogleHit } from '../google/google-places.service.js';
import type { Bbox } from '../regions/bbox.js';
import type { ExtractedPlace } from './place-extraction.js';
import type { RegionRef } from './region-lookup.service.js';

export type StoredOption =
  | { kind: 'catalog'; placeId: string; regionId: string }
  | { kind: 'google'; googlePlaceId: string; lat: number; lng: number; regionId: string };

export interface StoredCandidate {
  key: string;
  name: string;
  category: PlaceCategory;
  quote: string;
  confidence: 'high' | 'low' | 'none';
  options: StoredOption[];
}

export interface ResolverDeps {
  findRegion(hint: string): Promise<RegionRef | null>;
  matchCatalog(name: string, bbox: Bbox | null): Promise<{ placeId: string; lat: number; lng: number } | null>;
  /** Ném lỗi khi Google không dùng được. */
  searchGoogle(query: string, bbox: Bbox | null): Promise<GoogleHit[]>;
  assignRegions(points: Array<{ lat: number; lng: number }>): Promise<Array<string | null>>;
}

const MAX_GOOGLE_OPTIONS = 3;

export function insideBbox({ lat, lng }: { lat: number; lng: number }, bbox: Bbox): boolean {
  return lat >= bbox[0] && lat <= bbox[2] && lng >= bbox[1] && lng <= bbox[3];
}

type OptionWithoutRegion =
  | { kind: 'catalog'; placeId: string }
  | { kind: 'google'; googlePlaceId: string; lat: number; lng: number };

type Draft = Omit<StoredCandidate, 'options'> & {
  options: Array<{ option: OptionWithoutRegion; lat: number; lng: number }>;
};

/**
 * Mỗi tên: khớp danh mục OSM (trong vùng gợi ý, hoặc toàn quốc), không được
 * thì Google Text Search. Google hỏng thì chỉ còn danh mục (FR-4.3). Lựa
 * chọn nào không thuộc vùng nào thì bỏ, vì "Muốn đi" cần vùng.
 */
export async function resolvePlaces(
  places: ExtractedPlace[],
  deps: ResolverDeps,
): Promise<StoredCandidate[]> {
  const drafts = await Promise.all(
    places.map(async (place, i): Promise<Draft> => {
      const base = {
        key: `c${i + 1}`,
        name: place.name,
        category: place.category,
        quote: place.quote,
      };
      const region = place.regionHint ? await deps.findRegion(place.regionHint) : null;
      const bbox = region?.bbox ?? null;

      const match = await deps.matchCatalog(place.name, bbox);
      if (match) {
        return {
          ...base,
          confidence: 'high',
          options: [{ option: { kind: 'catalog', placeId: match.placeId }, lat: match.lat, lng: match.lng }],
        };
      }

      let hits: GoogleHit[] = [];
      try {
        const query = [place.name, place.address, region?.name ?? place.regionHint]
          .filter(Boolean)
          .join(', ');
        hits = await deps.searchGoogle(query, bbox);
      } catch {
        hits = [];
      }
      const toOption = (hit: GoogleHit) => ({
        option: { kind: 'google' as const, googlePlaceId: hit.placeId, lat: hit.lat, lng: hit.lng },
        lat: hit.lat,
        lng: hit.lng,
      });
      if (hits.length > 0 && bbox && insideBbox(hits[0], bbox)) {
        return { ...base, confidence: 'high', options: [toOption(hits[0])] };
      }
      return {
        ...base,
        confidence: hits.length > 0 ? 'low' : 'none',
        options: hits.slice(0, MAX_GOOGLE_OPTIONS).map(toOption),
      };
    }),
  );

  const points = drafts.flatMap((d) => d.options.map(({ lat, lng }) => ({ lat, lng })));
  const regionIds = await deps.assignRegions(points);
  let cursor = 0;
  return drafts.map((draft) => {
    const options: StoredOption[] = [];
    for (const { option } of draft.options) {
      const regionId = regionIds[cursor++];
      if (regionId) options.push({ ...option, regionId } as StoredOption);
    }
    const confidence = options.length === 0 ? 'none' : draft.confidence;
    return { ...draft, confidence, options };
  });
}
