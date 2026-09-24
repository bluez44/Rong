import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  GoogleContentStatus,
  GooglePlaceContent,
  PlaceCategory,
  PlaceDetail,
  PlaceListItem,
  PlacesPage,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import type { OpenDataConfig } from '../../config/configuration.js';
import { LangchainService } from '../../langchain/langchain.service.js';
import {
  GooglePlacesService,
  GoogleUnavailableError,
} from '../google/google-places.service.js';
import {
  OPEN_DATA_CONFIG,
  OpenDataService,
} from '../open-data/open-data.service.js';
import { OpenDataError } from '../open-data/http.js';
import type { Bbox } from '../regions/bbox.js';
import { RegionAreaService } from '../regions/region-area.service.js';
import {
  SERVICE_FILTERS,
  SIGHT_FILTERS,
  toPlaceDraft,
  type PlaceDraft,
} from './osm-place-mapping.js';
import { aiPlaceToListItem } from './ai-fallback.js';
import { PLACE_CATEGORIES } from './entities/place.entity.js';
import { hoursToday } from './opening-hours.js';
import { scorePlace } from './place-scoring.js';

export const ATTRIBUTION =
  '© OpenStreetMap contributors (ODbL) · Wikidata (CC0)';

/** Giới hạn số phần tử mỗi truy vấn Overpass, để vùng lớn (cả tỉnh) không kéo về hàng chục nghìn quán. */
const SIGHTS_CAP = 3000;
const SERVICES_CAP = 3000;
/** Chỉ tra Wikidata cho tối đa chừng này địa điểm mỗi lần làm mới. */
const WIKIDATA_CAP = 1000;

/** Địa điểm chưa ghép được với Google thì sau chừng này mới thử lại (quán mới mở có thể đã lên Google). */
const GOOGLE_REMATCH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

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
    private readonly areas: RegionAreaService,
    @Inject(OPEN_DATA_CONFIG) private readonly config: OpenDataConfig,
    private readonly google: GooglePlacesService,
    private readonly langchain: LangchainService,
  ) {}

  /**
   * Địa điểm trong vùng, xếp theo điểm tổng hợp giảm dần, 10 mục mỗi trang
   * (FR-2.10). "Trong vùng" nghĩa là tọa độ nằm trong khung bao của vùng.
   */
  async listForRegion(
    regionId: string,
    options: { categories?: PlaceCategory[]; cursor?: string; limit?: number },
  ): Promise<PlacesPage> {
    let bbox: Bbox | null = null;
    try {
      bbox = await this.areas.ensure(regionId);
      await this.ensureFresh(regionId, bbox);
    } catch (error) {
      if (!isOpenDataOutage(error)) throw error;
      // Làm mới lỗi nhưng đã có dữ liệu cũ thì dùng dữ liệu cũ; chưa có gì
      // mới phải nhờ tới Gemini + Google Maps.
      if (bbox === null || !(await this.hasPlaces(bbox))) {
        this.logger.warn(
          `Nguồn dữ liệu mở lỗi cho vùng ${regionId} (${(error as Error).message}); dùng Gemini + Google Maps.`,
        );
        return this.aiFallback(regionId, options.categories);
      }
      this.logger.warn(
        `Không làm mới được địa điểm vùng ${regionId}; dùng dữ liệu đã lưu. ${(error as Error).message}`,
      );
    }

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
        WHERE p.location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
          AND p.category = ANY($5::place_category[])
          AND ($6::int IS NULL OR p.composite_score < $6 OR (p.composite_score = $6 AND p.id > $7::uuid))
        ORDER BY p.composite_score DESC, p.id
        LIMIT $8`,
      [
        bbox[1],
        bbox[0],
        bbox[3],
        bbox[2],
        categories,
        cursor?.s ?? null,
        cursor?.id ?? null,
        limit + 1,
      ],
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
      source: 'catalog',
    };
  }

  private async hasPlaces(bbox: Bbox): Promise<boolean> {
    const [row] = (await this.db.query(
      `SELECT EXISTS (SELECT 1 FROM places WHERE location && ST_MakeEnvelope($1, $2, $3, $4, 4326)) AS found`,
      [bbox[1], bbox[0], bbox[3], bbox[2]],
    )) as Array<{ found: boolean }>;
    return row?.found === true;
  }

  /**
   * Dự phòng: Gemini có công cụ Google Maps. Kết quả không được lưu vào danh
   * mục (điều khoản Google Maps), không có id, không phân trang.
   */
  private async aiFallback(
    regionId: string,
    categories: PlaceCategory[] | undefined,
  ): Promise<PlacesPage> {
    const [region] = (await this.db.query(
      `SELECT r.name, p.name AS parent_name
         FROM regions r LEFT JOIN regions p ON p.id = r.parent_id
        WHERE r.id = $1`,
      [regionId],
    )) as Array<{ name: string; parent_name: string | null }>;
    if (!region) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'REGION_NOT_FOUND',
        message: 'Không tìm thấy vùng này.',
      });
    }

    const regionName = region.parent_name
      ? `${region.name}, ${region.parent_name}`
      : region.name;
    let result: Awaited<ReturnType<LangchainService['findPlaces']>>;
    try {
      result = await this.langchain.findPlaces(regionName);
    } catch (error) {
      this.logger.error(`Gemini cũng lỗi cho "${regionName}"`, error as Error);
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'PLACES_UNAVAILABLE',
        message: 'Tạm thời không lấy được địa điểm. Hãy thử lại sau.',
      });
    }

    const wanted = new Set(
      categories?.length ? categories : DEFAULT_CATEGORIES,
    );
    return {
      items: result.places
        .map((place) => aiPlaceToListItem(place, regionName))
        .filter(
          (item): item is PlaceListItem =>
            item !== null && wanted.has(item.category),
        ),
      nextCursor: null,
      attribution: 'Google Maps (qua Gemini)',
      source: 'ai_google_maps',
      groundingSources: result.sources,
    };
  }

  /**
   * Màn hình chi tiết (F5): dữ liệu riêng của app cộng nội dung Google gọi
   * theo thời gian thực. Google lỗi hay chưa cấu hình thì vẫn trả phần dữ liệu
   * riêng, kèm `googleStatus` để client hiển thị phù hợp.
   */
  async getDetail(id: string): Promise<PlaceDetail> {
    const [row] = (await this.db.query(
      `SELECT p.id, p.name, p.category, ST_Y(p.location) AS lat, ST_X(p.location) AS lng,
              p.composite_score, p.description, p.wikidata_id, p.osm_type, p.osm_id,
              p.tags->>'opening_hours' AS opening_hours,
              COALESCE(p.tags->>'website', p.tags->>'contact:website') AS website,
              p.google_place_id, p.google_matched_at
         FROM places p WHERE p.id = $1`,
      [id],
    )) as DetailRow[];

    if (!row) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'PLACE_NOT_FOUND',
        message: 'Không tìm thấy địa điểm này.',
      });
    }

    const { status, content } = await this.googleContent(row);
    return {
      ...toListItem(row),
      id: row.id,
      attribution: ATTRIBUTION,
      googleStatus: status,
      google: content,
    };
  }

  private async googleContent(row: DetailRow): Promise<{
    status: GoogleContentStatus;
    content: GooglePlaceContent | null;
  }> {
    if (!this.google.enabled) return { status: 'unavailable', content: null };

    try {
      let placeId = row.google_place_id;
      const retryDue =
        row.google_matched_at === null ||
        Date.now() - row.google_matched_at.getTime() > GOOGLE_REMATCH_AFTER_MS;

      if (placeId === null && retryDue) {
        placeId = await this.google.matchPlaceId(row.name, row.lat, row.lng);
        await this.db.query(
          `UPDATE places SET google_place_id = $2, google_matched_at = now() WHERE id = $1`,
          [row.id, placeId],
        );
      }
      if (placeId === null) return { status: 'not_found', content: null };

      const content = await this.google.details(placeId);
      if (content === null) {
        // place_id có thể hết hiệu lực (Google gộp/xóa địa điểm): bỏ đi để lần sau ghép lại.
        await this.db.query(
          `UPDATE places SET google_place_id = NULL, google_matched_at = now() WHERE id = $1`,
          [row.id],
        );
        return { status: 'not_found', content: null };
      }
      return { status: 'ok', content };
    } catch (error) {
      if (error instanceof GoogleUnavailableError) {
        this.logger.warn(
          `Google không sẵn sàng cho "${row.name}": ${error.message}`,
        );
        return { status: 'unavailable', content: null };
      }
      throw error;
    }
  }

  /** Tải lại địa điểm của vùng từ OSM nếu chưa từng tải hoặc đã quá hạn. */
  private ensureFresh(regionId: string, bbox: Bbox): Promise<void> {
    let pending = this.inFlight.get(regionId);
    if (!pending) {
      pending = this.refreshIfStale(regionId, bbox).finally(() =>
        this.inFlight.delete(regionId),
      );
      this.inFlight.set(regionId, pending);
    }
    return pending;
  }

  private async refreshIfStale(regionId: string, bbox: Bbox): Promise<void> {
    const [region] = (await this.db.query(
      `SELECT name, places_fetched_at FROM regions WHERE id = $1`,
      [regionId],
    )) as Array<{ name: string; places_fetched_at: Date | null }>;

    const maxAgeMs = this.config.placesRefreshDays * 24 * 60 * 60 * 1000;
    if (
      region.places_fetched_at &&
      Date.now() - region.places_fetched_at.getTime() < maxAgeMs
    ) {
      return;
    }

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

interface DetailRow extends PlaceRow {
  google_place_id: string | null;
  google_matched_at: Date | null;
}

/** Lỗi do nguồn dữ liệu mở (mạng, quá tải, không xác định được khu vực) — đáng chuyển sang dự phòng. */
function isOpenDataOutage(error: unknown): boolean {
  if (error instanceof OpenDataError) return true;
  if (error instanceof HttpException && error.getStatus() === 503) return true;
  return false;
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
    hours: hoursToday(row.opening_hours),
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
