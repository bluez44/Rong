import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  AttributedPage,
  PlaceCategory,
  PlaceListItem,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import type { OpenDataConfig } from '../../config/configuration.js';
import {
  OPEN_DATA_CONFIG,
  OpenDataService,
} from '../open-data/open-data.service.js';
import type { Bbox } from '../open-data/open-data.types.js';
import { BoundaryService } from '../regions/boundary.service.js';
import {
  SERVICE_FILTERS,
  SIGHT_FILTERS,
  toPlaceDraft,
  type PlaceDraft,
} from './osm-place-mapping.js';
import { PLACE_CATEGORIES } from './entities/place.entity.js';
import { scorePlace } from './place-scoring.js';

export const ATTRIBUTION =
  '© OpenStreetMap contributors (ODbL) · Wikidata (CC0)';

/** Giới hạn số phần tử mỗi truy vấn Overpass, để vùng lớn (cả tỉnh) không kéo về hàng chục nghìn quán. */
const SIGHTS_CAP = 3000;
const SERVICES_CAP = 3000;
/** Chỉ tra Wikidata cho tối đa chừng này địa điểm mỗi lần làm mới. */
const WIKIDATA_CAP = 1000;

/** Mặc định không gồm lưu trú, để khách sạn không lấn át điểm vui chơi (FR-2.12). */
const DEFAULT_CATEGORIES = PLACE_CATEGORIES.filter((c) => c !== 'stay');

interface Cursor {
  s: number;
  id: string;
}

interface PlaceRow {
  id: string;
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  composite_score: number;
  description: string | null;
  opening_hours: string | null;
  website: string | null;
  wikidata_id: string | null;
  osm_type: string;
  osm_id: string;
}

@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly openData: OpenDataService,
    private readonly boundaries: BoundaryService,
    @Inject(OPEN_DATA_CONFIG) private readonly config: OpenDataConfig,
  ) {}

  /**
   * Địa điểm trong vùng, xếp theo điểm tổng hợp giảm dần, 10 mục mỗi trang
   * (FR-2.10). "Trong vùng" nghĩa là tọa độ nằm trong polygon — FR-1.10.
   */
  async listForRegion(
    regionId: string,
    options: { categories?: PlaceCategory[]; cursor?: string; limit?: number },
  ): Promise<AttributedPage<PlaceListItem>> {
    await this.boundaries.ensure(regionId);
    await this.ensureFresh(regionId);

    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const categories = options.categories?.length
      ? options.categories
      : DEFAULT_CATEGORIES;
    const cursor = decodeCursor(options.cursor);

    const rows = (await this.db.query(
      `SELECT p.id, p.name, p.category, ST_Y(p.location) AS lat, ST_X(p.location) AS lng,
              p.composite_score, p.description, p.wikidata_id, p.osm_type, p.osm_id,
              p.tags->>'opening_hours' AS opening_hours,
              COALESCE(p.tags->>'website', p.tags->>'contact:website') AS website
         FROM places p
         JOIN regions r ON r.id = $1 AND ST_Covers(r.boundary, p.location)
        WHERE p.category = ANY($2::place_category[])
          AND ($3::int IS NULL OR p.composite_score < $3 OR (p.composite_score = $3 AND p.id > $4::uuid))
        ORDER BY p.composite_score DESC, p.id
        LIMIT $5`,
      [regionId, categories, cursor?.s ?? null, cursor?.id ?? null, limit + 1],
    )) as PlaceRow[];

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toListItem),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ s: last.composite_score, id: last.id })
          : null,
      attribution: ATTRIBUTION,
    };
  }

  /** Tải lại địa điểm của vùng từ OSM nếu chưa từng tải hoặc đã quá hạn. */
  private ensureFresh(regionId: string): Promise<void> {
    let pending = this.inFlight.get(regionId);
    if (!pending) {
      pending = this.refreshIfStale(regionId).finally(() =>
        this.inFlight.delete(regionId),
      );
      this.inFlight.set(regionId, pending);
    }
    return pending;
  }

  private async refreshIfStale(regionId: string): Promise<void> {
    const [region] = (await this.db.query(
      `SELECT name, places_fetched_at,
              ST_YMin(boundary) AS s, ST_XMin(boundary) AS w, ST_YMax(boundary) AS n, ST_XMax(boundary) AS e
         FROM regions WHERE id = $1`,
      [regionId],
    )) as Array<{
      name: string;
      places_fetched_at: Date | null;
      s: number;
      w: number;
      n: number;
      e: number;
    }>;

    const maxAgeMs = this.config.placesRefreshDays * 24 * 60 * 60 * 1000;
    if (
      region.places_fetched_at &&
      Date.now() - region.places_fetched_at.getTime() < maxAgeMs
    ) {
      return;
    }

    const bbox: Bbox = [region.s, region.w, region.n, region.e];
    const started = Date.now();
    const sights = await this.openData.placesInBbox(
      bbox,
      SIGHT_FILTERS,
      SIGHTS_CAP,
    );
    const services = await this.openData.placesInBbox(
      bbox,
      SERVICE_FILTERS,
      SERVICES_CAP,
    );

    const drafts = dedupe(
      [...sights, ...services]
        .map(toPlaceDraft)
        .filter((d): d is PlaceDraft => d !== null),
    );
    const wikidataIds = [
      ...new Set(
        drafts
          .map((d) => d.wikidataId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const wiki = await this.openData
      .wikidata(wikidataIds.slice(0, WIKIDATA_CAP))
      .catch((error: Error) => {
        // Thiếu Wikidata chỉ làm điểm kém chính xác hơn, không đáng làm hỏng cả lần tải.
        this.logger.warn(`Wikidata lỗi: ${error.message}`);
        return new Map();
      });

    const rows = drafts.map((draft) => {
      const info = draft.wikidataId ? wiki.get(draft.wikidataId) : undefined;
      const sitelinks = info?.sitelinks ?? null;
      return {
        osm_type: draft.osmType,
        osm_id: draft.osmId,
        name: draft.name,
        category: draft.category,
        lat: draft.lat,
        lng: draft.lng,
        tags: draft.tags,
        wikidata_id: draft.wikidataId,
        sitelinks,
        description: info?.description ?? null,
        score: scorePlace({
          category: draft.category,
          tags: draft.tags,
          wikidataId: draft.wikidataId,
          sitelinks,
        }),
      };
    });

    for (let i = 0; i < rows.length; i += 1000) {
      await this.db.query(
        `INSERT INTO places (osm_type, osm_id, name, category, location, tags, wikidata_id, sitelinks,
                             description, composite_score)
         SELECT r.osm_type, r.osm_id, r.name, r.category::place_category,
                ST_SetSRID(ST_MakePoint(r.lng, r.lat), 4326), r.tags, r.wikidata_id, r.sitelinks,
                r.description, r.score
           FROM jsonb_to_recordset($1::jsonb) AS r(osm_type text, osm_id bigint, name text, category text,
                lat float8, lng float8, tags jsonb, wikidata_id text, sitelinks int, description text, score int)
         ON CONFLICT (osm_type, osm_id) DO UPDATE SET
           name = EXCLUDED.name, category = EXCLUDED.category, location = EXCLUDED.location,
           tags = EXCLUDED.tags, wikidata_id = EXCLUDED.wikidata_id, sitelinks = EXCLUDED.sitelinks,
           description = EXCLUDED.description, composite_score = EXCLUDED.composite_score, updated_at = now()`,
        [JSON.stringify(rows.slice(i, i + 1000))],
      );
    }

    await this.db.query(
      `UPDATE regions SET places_fetched_at = now() WHERE id = $1`,
      [regionId],
    );
    this.logger.log(
      `"${region.name}": ${rows.length} địa điểm từ OSM (${wikidataIds.length} có Wikidata) trong ${Date.now() - started} ms`,
    );
  }
}

/** Cùng một phần tử có thể khớp nhiều bộ lọc (ví dụ cả tourism lẫn historic). */
function dedupe(drafts: PlaceDraft[]): PlaceDraft[] {
  const seen = new Map<string, PlaceDraft>();
  for (const draft of drafts)
    seen.set(`${draft.osmType}/${draft.osmId}`, draft);
  return [...seen.values()];
}

function toListItem(row: PlaceRow): PlaceListItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    coordinates: { lat: row.lat, lng: row.lng },
    compositeScore: row.composite_score,
    description: row.description,
    openingHours: row.opening_hours,
    website: row.website,
    wikidataId: row.wikidata_id,
    sourceUrl: `https://www.openstreetmap.org/${row.osm_type}/${row.osm_id}`,
  };
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString(),
    ) as Cursor;
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return Number.isInteger(parsed.s) && uuid.test(parsed.id) ? parsed : null;
  } catch {
    return null;
  }
}
