import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  ArticleSource,
  PlaceCategory,
  PlaceListItem,
  PlacesPage,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import type { WebPlacesType } from '../../chat-models/schema.js';
import { PlaceSearchService } from '../../langchain/place-search.service.js';
import { GooglePlacesService } from '../google/google-places.service.js';
import type { Bbox } from '../regions/bbox.js';
import { RegionAreaService } from '../regions/region-area.service.js';
import { aiPlaceToListItem } from './ai-fallback.js';
import { PLACE_CATEGORIES } from './entities/place.entity.js';
import { hoursToday } from './opening-hours.js';
import { articlesMentioning, fetchPublishedDate } from './web-grounding.js';

/**
 * Kết quả agent (tên, địa chỉ, mô tả, bài viết nguồn kèm ngày đăng) của một
 * vùng được giữ chừng này. Tọa độ không nằm trong cache này mà tra lại mỗi
 * request; GooglePlacesService tự cache tọa độ Geocoding tối đa 30 ngày (PRD 7.4).
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Độ giống tên tối thiểu (pg_trgm, đã bỏ dấu) để coi là cùng địa điểm trong danh mục. */
const CATALOG_MIN_SIMILARITY = 0.6;
/** Tỉ lệ độ dài tối thiểu giữa hai tên (ngắn / dài) khi so khớp danh mục. */
const CATALOG_MIN_LENGTH_RATIO = 0.75;
/** Nới khung bao khi kiểm tra tọa độ AI ước lượng (~2 km). */
const AI_LOCATION_PADDING_DEG = 0.02;
/**
 * Chờ đọc ngày đăng bài tối đa chừng này rồi trả kết quả; bài chưa xong vẫn
 * tải tiếp ở nền và điền vào kết quả trong cache cho lần sau.
 */
const DATES_WAIT_MS = 1500;
/** Tương tự với khung bao của vùng chưa có (Overpass có thể mất cả phút). */
const BBOX_WAIT_MS = 3000;
/** Mỗi lượt Geocoding; quá giờ thì dùng tọa độ AI nếu nằm trong vùng. */
const GEOCODE_TIMEOUT_MS = 4000;

const DEFAULT_CATEGORIES = PLACE_CATEGORIES.filter((c) => c !== 'stay');

/** Địa điểm của agent đã được đối chiếu: có ít nhất một bài viết nhắc tới. */
type GroundedPlace = WebPlacesType[number] & { articles: ArticleSource[] };

interface RegionRow {
  name: string;
  parent_name: string | null;
  bbox: Bbox | null;
}

interface AgentResult {
  regionName: string;
  /** null khi chưa tính xong trong BBOX_WAIT_MS; được điền sau khi có. */
  bbox: Bbox | null;
  places: GroundedPlace[];
  sources: ArticleSource[];
}

interface CacheEntry {
  expiresAt: number;
  result: Promise<AgentResult>;
}

interface CatalogMatch {
  idx: string;
  id: string;
  lat: number;
  lng: number;
  osm_type: string;
  osm_id: string;
  wikidata_id: string | null;
  opening_hours: string | null;
  website: string | null;
}

/** Thời gian định vị của một request, ghi ra log để theo dõi độ chậm. */
interface LocateTiming {
  catalogMs: number;
  catalogMatched: number;
  /** Cả loạt gọi song song, tính từ lúc bắt đầu tới khi lượt cuối xong. */
  geocodeMs: number;
  geocodeCalls: number;
  geocodeFound: number;
  geocodeSlowestMs: number;
}

/** Vị trí đã tra được cho một địa điểm; null thì dùng tọa độ AI ước lượng. */
type Resolved =
  | { from: 'catalog'; match: CatalogMatch }
  | { from: 'google'; placeId: string; lat: number; lng: number };

/**
 * API v2 cho danh sách địa điểm của vùng: agent LangChain tìm web và đọc bài
 * viết để chọn địa điểm. Server đối chiếu lại: tên địa điểm phải xuất hiện
 * trong nội dung bài model đã đọc, không thì bỏ (model tự thêm).
 *
 * Tọa độ lấy từ danh mục OSM trong DB, rồi Google Geocoding API; không định
 * vị được (kể cả Geocoding lỗi hay chưa bật) thì dùng tọa độ AI ước lượng nếu
 * nằm trong vùng, đánh dấu `locationSource: 'ai'`.
 */
@Injectable()
export class PlacesV2Service {
  private readonly logger = new Logger(PlacesV2Service.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly agent: PlaceSearchService,
    private readonly areas: RegionAreaService,
    private readonly google: GooglePlacesService,
  ) {}

  async listForRegion(
    regionId: string,
    options: { categories?: PlaceCategory[] },
  ): Promise<PlacesPage> {
    if (!this.agent.enabled) throw unavailable();

    const started = Date.now();
    const cached = this.isCached(regionId);
    const result = await this.searchCached(regionId);
    const agentMs = Date.now() - started;

    const wanted = new Set(
      options.categories?.length ? options.categories : DEFAULT_CATEGORIES,
    );
    // Lọc loại trước khi tra tọa độ để không tốn lượt gọi Google cho mục bị bỏ.
    const places = result.places.filter((place) => wanted.has(place.category));

    const { resolved, timing } = await this.resolveLocations(places, result);
    const items = dedupe(
      places.flatMap((place, i) => {
        const item = toItem(place, resolved[i], result);
        return item ? [item] : [];
      }),
    );
    const fromGoogle = resolved.some((r) => r?.from === 'google');
    this.logger.log(
      `"${result.regionName}": ${items.length}/${places.length} địa điểm trong ${Date.now() - started} ms — ` +
        `agent ${cached ? 'cache' : `${agentMs} ms`}; ` +
        `danh mục ${timing.catalogMatched} khớp / ${timing.catalogMs} ms; ` +
        `Geocoding ${timing.geocodeFound}/${timing.geocodeCalls} / ${timing.geocodeMs} ms (chậm nhất ${timing.geocodeSlowestMs} ms); ` +
        `tọa độ AI ${items.filter((i) => i.locationSource === 'ai').length}`,
    );

    return {
      items,
      nextCursor: null,
      attribution: fromGoogle
        ? 'Tổng hợp từ bài viết trên web (AI) · Vị trí: © OpenStreetMap contributors, Google Maps'
        : 'Tổng hợp từ bài viết trên web (AI) · Vị trí: © OpenStreetMap contributors',
      source: 'ai_web_search',
      groundingSources: result.sources,
    };
  }

  private isCached(regionId: string): boolean {
    const hit = this.cache.get(regionId);
    return hit !== undefined && hit.expiresAt > Date.now();
  }

  /** Gộp các request cùng vùng đang chạy và giữ kết quả CACHE_TTL_MS. */
  private searchCached(regionId: string): Promise<AgentResult> {
    const hit = this.cache.get(regionId);
    if (hit && hit.expiresAt > Date.now()) return hit.result;

    const result = this.search(regionId);
    this.cache.set(regionId, { expiresAt: Date.now() + CACHE_TTL_MS, result });
    // Lỗi thì không giữ, để lần sau thử lại.
    result.catch(() => this.cache.delete(regionId));
    return result;
  }

  private async search(regionId: string): Promise<AgentResult> {
    const [region] = (await this.db.query(
      `SELECT r.name, p.name AS parent_name,
              CASE WHEN r.bbox_south IS NULL THEN NULL
                   ELSE ARRAY[r.bbox_south, r.bbox_west, r.bbox_north, r.bbox_east] END AS bbox
         FROM regions r LEFT JOIN regions p ON p.id = r.parent_id
        WHERE r.id = $1`,
      [regionId],
    )) as RegionRow[];
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

    // Vùng chưa có khung bao thì tính (Nominatim, một lần rồi lưu) song song
    // với agent, nên không làm chậm thêm. Lỗi thì tra tọa độ không giới hạn vùng.
    const bbox = region.bbox
      ? Promise.resolve(region.bbox)
      : this.areas.ensure(regionId).catch((error: Error) => {
          this.logger.warn(
            `Không tính được khung bao "${regionName}": ${error.message}`,
          );
          return null;
        });

    const started = Date.now();
    let found: Awaited<ReturnType<PlaceSearchService['findPlaces']>>;
    try {
      found = await this.agent.findPlaces(regionName);
    } catch (error) {
      this.logger.error(
        `Agent tìm địa điểm lỗi cho "${regionName}"`,
        error as Error,
      );
      throw unavailable();
    }
    this.logger.log(
      `"${regionName}": agent trả ${found.places.length} địa điểm từ ${found.sources.length} bài viết trong ${Date.now() - started} ms`,
    );

    const grounded = found.places.flatMap((place) => {
      const articles = articlesMentioning(
        place.title,
        regionName,
        found.sources,
      );
      return articles.length > 0 ? [{ place, articles }] : [];
    });
    const dropped = found.places
      .filter((place) => !grounded.some((g) => g.place === place))
      .map((place) => place.title);
    if (dropped.length > 0) {
      this.logger.warn(
        `"${regionName}": bỏ ${dropped.length} địa điểm không có trong bài viết nào: ${dropped.join('; ')}`,
      );
    }

    // Ngày đăng: Tavily hiếm khi có, nên đọc meta của trang; chỉ tải các bài
    // thật sự được dẫn. Mỗi bài là một object dùng chung giữa các địa điểm và
    // danh sách nguồn, nên điền ngày muộn vẫn hiện ở mọi chỗ.
    const cited = new Map<string, ArticleSource>();
    for (const { articles } of grounded) {
      for (const article of articles) {
        if (!cited.has(article.uri)) {
          cited.set(article.uri, {
            title: article.title,
            uri: article.uri,
            publishedAt: article.publishedAt,
          });
        }
      }
    }
    const datesStarted = Date.now();
    const lookups = [...cited.values()]
      .filter((article) => article.publishedAt === null)
      .map(async (article) => {
        article.publishedAt = await fetchPublishedDate(article.uri);
      });
    const datesDone = await waitAtMost(Promise.all(lookups), DATES_WAIT_MS);
    this.logger.log(
      `"${regionName}": ngày đăng ${[...cited.values()].filter((a) => a.publishedAt).length}/${cited.size} bài trong ${Date.now() - datesStarted} ms` +
        (datesDone ? '' : ' (phần còn lại tải ở nền)'),
    );

    const result: AgentResult = {
      regionName,
      bbox: null,
      places: grounded.map(({ place, articles }) => ({
        ...place,
        articles: articles.map((article) => cited.get(article.uri)!),
      })),
      sources: [...cited.values()],
    };
    // Khung bao chưa có trong BBOX_WAIT_MS thì trả trước (tra tọa độ không
    // giới hạn vùng), điền vào kết quả trong cache khi tính xong.
    const box = bbox.then((value) => {
      result.bbox = value;
    });
    if (!(await waitAtMost(box, BBOX_WAIT_MS))) {
      this.logger.warn(
        `"${regionName}": khung bao chưa có sau ${BBOX_WAIT_MS} ms, trả kết quả trước`,
      );
    }
    return result;
  }

  private async resolveLocations(
    places: GroundedPlace[],
    { regionName, bbox }: AgentResult,
  ): Promise<{ resolved: Array<Resolved | null>; timing: LocateTiming }> {
    const resolved: Array<Resolved | null> = places.map(() => null);
    const timing: LocateTiming = {
      catalogMs: 0,
      catalogMatched: 0,
      geocodeMs: 0,
      geocodeCalls: 0,
      geocodeFound: 0,
      geocodeSlowestMs: 0,
    };
    if (places.length === 0) return { resolved, timing };

    if (bbox) {
      const started = Date.now();
      const matches = await this.matchCatalog(places, bbox);
      timing.catalogMs = Date.now() - started;
      timing.catalogMatched = matches.length;
      for (const match of matches) {
        resolved[Number(match.idx) - 1] = { from: 'catalog', match };
      }
    }

    if (!this.google.enabled) return { resolved, timing };
    const pending = places
      .map((place, i) => ({ place, i }))
      .filter(({ i }) => resolved[i] === null);
    const started = Date.now();
    const lookups = await Promise.allSettled(
      pending.map(async ({ place }) => {
        const callStarted = Date.now();
        try {
          return await this.google.geocode(
            [place.title, place.address, regionName]
              .map((part) => part?.trim())
              .filter(Boolean)
              .join(', '),
            bbox,
            GEOCODE_TIMEOUT_MS,
          );
        } finally {
          timing.geocodeSlowestMs = Math.max(
            timing.geocodeSlowestMs,
            Date.now() - callStarted,
          );
        }
      }),
    );
    timing.geocodeMs = Date.now() - started;
    timing.geocodeCalls = pending.length;

    const errors: string[] = [];
    lookups.forEach((lookup, j) => {
      if (lookup.status === 'fulfilled' && lookup.value) {
        resolved[pending[j].i] = { from: 'google', ...lookup.value };
        timing.geocodeFound++;
      } else if (lookup.status === 'rejected') {
        errors.push((lookup.reason as Error).message);
      }
    });
    // Geocoding hỏng (chưa bật billing, hết quota…) thì mọi lượt cùng lỗi: gộp một dòng.
    if (errors.length > 0) {
      this.logger.warn(
        `Geocoding lỗi ${errors.length}/${pending.length} lượt, dùng tọa độ AI: ${[...new Set(errors)].join('; ')}`,
      );
    }
    return { resolved, timing };
  }

  /** Mỗi tên lấy địa điểm giống nhất trong khung bao của vùng, một truy vấn cho cả danh sách. */
  private matchCatalog(
    places: GroundedPlace[],
    bbox: Bbox,
  ): Promise<CatalogMatch[]> {
    return this.db.query(
      `WITH candidates AS (
         SELECT p.*, unaccent(lower(p.name)) AS norm
           FROM places p
          WHERE p.location && ST_MakeEnvelope($2, $3, $4, $5, 4326)
       )
       SELECT n.idx, m.*
         FROM unnest($1::text[]) WITH ORDINALITY AS n(name, idx)
         CROSS JOIN LATERAL (SELECT unaccent(lower(n.name)) AS q) nq
         CROSS JOIN LATERAL (
           SELECT c.id, ST_Y(c.location) AS lat, ST_X(c.location) AS lng,
                  c.osm_type, c.osm_id, c.wikidata_id,
                  c.tags->>'opening_hours' AS opening_hours,
                  COALESCE(c.tags->>'website', c.tags->>'contact:website') AS website
             FROM candidates c
            WHERE similarity(c.norm, nq.q) >= $6
              -- Tên ngắn nằm gọn trong tên dài vẫn đủ giống ("Chợ Đà Lạt" ~ "Đà Lạt"),
              -- nên bắt độ dài (đã bỏ dấu) phải gần nhau.
              AND least(length(c.norm), length(nq.q))::float8
                  / greatest(length(c.norm), length(nq.q)) >= $7
            ORDER BY similarity(c.norm, nq.q) DESC
            LIMIT 1
         ) m`,
      [
        places.map((place) => place.title),
        bbox[1],
        bbox[0],
        bbox[3],
        bbox[2],
        CATALOG_MIN_SIMILARITY,
        CATALOG_MIN_LENGTH_RATIO,
      ],
    ) as Promise<CatalogMatch[]>;
  }
}

function toItem(
  place: GroundedPlace,
  resolved: Resolved | null,
  { regionName, bbox }: AgentResult,
): PlaceListItem | null {
  const location = !resolved
    ? place.location
    : resolved.from === 'catalog'
      ? { lat: resolved.match.lat, lng: resolved.match.lng }
      : { lat: resolved.lat, lng: resolved.lng };
  const item = aiPlaceToListItem({ ...place, location }, regionName);
  if (!item) return null;
  const withArticles = { ...item, articles: place.articles };

  if (!resolved) {
    // Tọa độ AI chỉ dùng khi còn nằm trong vùng; lệch ra ngoài thì chắc chắn sai.
    return insideBbox(item.coordinates, bbox, AI_LOCATION_PADDING_DEG)
      ? { ...withArticles, locationSource: 'ai' }
      : null;
  }

  if (resolved.from === 'google') {
    return {
      ...withArticles,
      locationSource: 'geocoding',
      sourceUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.title)}&query_place_id=${resolved.placeId}`,
    };
  }

  // Khớp danh mục: có id thật (mở được màn chi tiết), ưu tiên dữ liệu OSM.
  const { match } = resolved;
  const openingHours = match.opening_hours ?? item.openingHours;
  return {
    ...withArticles,
    locationSource: 'catalog',
    id: match.id,
    openingHours,
    hours: hoursToday(openingHours),
    website: match.website,
    wikidataId: match.wikidata_id,
    sourceUrl: `https://www.openstreetmap.org/${match.osm_type}/${match.osm_id}`,
  };
}

/** Chưa biết khung bao của vùng thì không lọc (aiPlaceToListItem đã chặn ngoài Việt Nam). */
function insideBbox(
  { lat, lng }: { lat: number; lng: number },
  bbox: Bbox | null,
  padding: number,
): boolean {
  if (!bbox) return true;
  const [south, west, north, east] = bbox;
  return (
    lat >= south - padding &&
    lat <= north + padding &&
    lng >= west - padding &&
    lng <= east + padding
  );
}

/** true nếu `promise` xong trong `ms`; không hủy promise khi quá giờ. */
async function waitAtMost(
  promise: Promise<unknown>,
  ms: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: 'PLACES_UNAVAILABLE',
    message: 'Tạm thời không lấy được địa điểm. Hãy thử lại sau.',
  });
}

/** Nhiều truy vấn song song, hoặc hai tên gọi khác nhau, có thể ra cùng một địa điểm. */
function dedupe(items: PlaceListItem[]): PlaceListItem[] {
  const seen = new Map<string, PlaceListItem>();
  for (const item of items) {
    const name = item.name.normalize('NFC').toLowerCase();
    // Tọa độ AI hay trùng nhau (tâm thành phố) dù là hai nơi khác nhau: chỉ so tên.
    const key =
      item.id ??
      (item.locationSource === 'geocoding'
        ? `${item.coordinates.lat.toFixed(5)},${item.coordinates.lng.toFixed(5)}`
        : name);
    if (!seen.has(key) && !seen.has(name)) {
      seen.set(key, item);
      seen.set(name, item);
    }
  }
  return [...new Set(seen.values())];
}
