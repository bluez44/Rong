import {
  Inject,
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
import type { WebPlacesConfig } from '../../config/configuration.js';
import { PlaceSearchService as AgentPlaceSearch } from '../../langchain/place-search.service.js';
import { GooglePlacesService } from '../google/google-places.service.js';
import type { Bbox } from '../regions/bbox.js';
import { RegionAreaService } from '../regions/region-area.service.js';
import { PLACE_CATEGORIES } from './entities/place.entity.js';
import { hoursToday } from './opening-hours.js';
import { PlaceLocationService } from './place-location.service.js';
import {
  RegionPlaceStore,
  type StoredPlaceRow,
  type WebPlaceInput,
} from './region-place-store.js';
import {
  articlesMentioning,
  fetchPublishedDate,
  groundedAddress,
} from './web-grounding.js';
import { pickGoogleMatch } from './web-place-match.js';

export const WEB_PLACES_CONFIG = 'WEB_PLACES_CONFIG';

const ATTRIBUTION = 'Tổng hợp từ bài viết trên web (AI) · Vị trí: Google Maps';
/** Nới khung bao khi giữ tọa độ AI (~2 km): lệch xa hơn thì chắc chắn sai. */
const AI_LOCATION_PADDING_DEG = 0.02;
/** Số lượt Text Search chạy cùng lúc cho một vùng. */
const MATCH_CONCURRENCY = 5;
/** Chờ đọc ngày đăng bài tối đa chừng này; phần còn lại bỏ qua. */
const DATES_WAIT_MS = 1500;
/** Mặc định không gồm lưu trú, để khách sạn không lấn át điểm vui chơi (FR-2.12). */
const DEFAULT_CATEGORIES = PLACE_CATEGORIES.filter((c) => c !== 'stay');
const HHMM = /^([01]?\d|2[0-4]):[0-5]\d$/;

/**
 * Danh sách địa điểm của một vùng (spec 2026-10-14-web-places): tổng hợp từ
 * bài viết (Tavily + Gemini), ghép Google Places để lấy place_id + tọa độ,
 * lưu vào `places` / `region_places`. Lần đầu request chờ tối đa `waitMs`;
 * quá hạn thì trả bản cũ và làm mới ở nền.
 */
@Injectable()
export class WebPlacesService {
  private readonly logger = new Logger(WebPlacesService.name);
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(WEB_PLACES_CONFIG) private readonly config: WebPlacesConfig,
    private readonly agent: AgentPlaceSearch,
    private readonly google: GooglePlacesService,
    private readonly areas: RegionAreaService,
    private readonly store: RegionPlaceStore,
    private readonly locations: PlaceLocationService,
  ) {}

  async listForRegion(
    regionId: string,
    categories: PlaceCategory[] | undefined,
  ): Promise<PlacesPage> {
    const regionName = await this.regionName(regionId);
    const state = await this.store.state(regionId);

    if (state?.status !== 'ready') {
      if (!this.agent.enabled) throw unavailable();
      const done = await waitAtMost(
        this.refresh(regionId, regionName),
        this.config.waitMs,
      );
      if (!done) return building();
      const after = await this.store.state(regionId);
      if (after?.status !== 'ready') throw unavailable();
    } else if (
      state.expiresAt &&
      state.expiresAt.getTime() <= Date.now() &&
      this.agent.enabled
    ) {
      // Quá hạn: trả bản đang có, làm mới ở nền (lỗi đã được ghi trong build).
      void this.refresh(regionId, regionName).catch(() => undefined);
    }

    const wanted = categories?.length ? categories : DEFAULT_CATEGORIES;
    let rows = await this.store.list(regionId, wanted);
    const stale = rows
      .filter((r) => r.location_source === 'google' && r.lat === null)
      .map((r) => r.id);
    if (stale.length > 0) {
      await this.locations.ensure(stale);
      rows = await this.store.list(regionId, wanted);
    }
    const current = await this.store.state(regionId);
    return {
      status: 'ready',
      items: rows.flatMap((r) => toItem(r, regionName)),
      attribution: ATTRIBUTION,
      source: 'web',
      sources: current?.sources ?? [],
    };
  }

  /**
   * Một lượt pipeline cho vùng; các lời gọi trong lúc đang chạy dùng chung.
   * Không ném lỗi pipeline: lỗi được ghi vào `region_place_lists`.
   */
  refresh(regionId: string, regionName?: string): Promise<void> {
    let pending = this.inFlight.get(regionId);
    if (!pending) {
      pending = this.build(regionId, regionName).finally(() =>
        this.inFlight.delete(regionId),
      );
      this.inFlight.set(regionId, pending);
    }
    return pending;
  }

  private async build(regionId: string, knownName?: string): Promise<void> {
    const regionName = knownName ?? (await this.regionName(regionId));
    const started = Date.now();
    await this.store.markBuilding(regionId);
    try {
      const bbox = await this.areas.ensure(regionId).catch((error: Error) => {
        this.logger.warn(
          `Không tính được khung bao "${regionName}": ${error.message}`,
        );
        return null;
      });
      const found = await this.agent.findPlaces(regionName);
      const grounded = found.places.flatMap((place) => {
        const articles = articlesMentioning(
          place.title,
          regionName,
          found.sources,
        );
        return articles.length > 0 ? [{ place, articles }] : [];
      });

      const cited = new Map<string, ArticleSource>();
      for (const { articles } of grounded) {
        for (const a of articles) {
          if (!cited.has(a.uri)) {
            cited.set(a.uri, {
              title: a.title,
              uri: a.uri,
              publishedAt: a.publishedAt,
            });
          }
        }
      }
      await waitAtMost(
        Promise.all(
          [...cited.values()]
            .filter((a) => a.publishedAt === null)
            .map(async (a) => {
              a.publishedAt = await fetchPublishedDate(a.uri);
            }),
        ),
        DATES_WAIT_MS,
      );

      const located = await this.locate(
        grounded.map((g) => g.place),
        regionName,
        bbox,
      );
      const inputs = grounded.flatMap(({ place, articles }, i) => {
        const location = located[i];
        if (!location) return [];
        const input: WebPlaceInput = {
          name: place.title.trim(),
          category: place.category,
          address: groundedAddress(place.address, articles),
          description: place.description.trim() || null,
          openingHours: openingHours(place.openHours),
          // Bản sao để ngày đăng đọc về muộn không đổi dữ liệu đã lưu.
          articles: articles.map((a) => ({ ...cited.get(a.uri)! })),
          location,
        };
        return [input];
      });

      await this.store.replace(
        regionId,
        inputs,
        [...cited.values()].map((a) => ({ ...a })),
        this.config.refreshDays,
      );
      const matched = inputs.filter((p) => p.location.source === 'google');
      this.logger.log(
        `"${regionName}": lưu ${inputs.length}/${found.places.length} địa điểm (${matched.length} ghép Google) trong ${Date.now() - started} ms`,
      );
    } catch (error) {
      this.logger.error(
        `Tổng hợp địa điểm "${regionName}" lỗi`,
        (error as Error).stack,
      );
      await this.store.markFailed(regionId, 'PLACES_UNAVAILABLE');
    }
  }

  /**
   * Ghép từng địa điểm với Google (song song có giới hạn) khi bật `googleMatch`; không ghép
   * (tắt, hay không khớp) thì dùng tọa độ AI nếu nằm trong vùng; ngoài vùng thì bỏ.
   */
  private async locate(
    places: WebPlacesType,
    regionName: string,
    bbox: Bbox | null,
  ): Promise<Array<WebPlaceInput['location'] | null>> {
    const out: Array<WebPlaceInput['location'] | null> = places.map(() => null);
    let googleErrors = 0;
    let next = 0;
    const worker = async () => {
      while (next < places.length) {
        const i = next++;
        const place = places[i];
        if (bbox && this.config.googleMatch && this.google.enabled) {
          try {
            const query = [place.title, place.address, regionName]
              .map((s) => s.trim())
              .filter(Boolean)
              .join(', ');
            const match = pickGoogleMatch(
              place.title,
              place.category,
              await this.google.findPlace(query, bbox),
            );
            if (match) {
              out[i] = {
                source: 'google',
                placeId: match.placeId,
                lat: match.lat,
                lng: match.lng,
              };
              continue;
            }
          } catch {
            googleErrors++;
          }
        }
        const { lat, lng } = place.location;
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          insideBbox(lat, lng, bbox)
        ) {
          out[i] = { source: 'ai', lat, lng };
        }
      }
    };
    await Promise.all(Array.from({ length: MATCH_CONCURRENCY }, worker));
    if (googleErrors > 0) {
      this.logger.warn(
        `"${regionName}": ghép Google lỗi ${googleErrors}/${places.length} lượt, dùng tọa độ AI`,
      );
    }
    return out;
  }

  private async regionName(regionId: string): Promise<string> {
    const [row] = (await this.db.query(
      `SELECT r.name, p.name AS parent_name
         FROM regions r LEFT JOIN regions p ON p.id = r.parent_id
        WHERE r.id = $1`,
      [regionId],
    )) as Array<{ name: string; parent_name: string | null }>;
    if (!row) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'REGION_NOT_FOUND',
        message: 'Không tìm thấy vùng này.',
      });
    }
    return row.parent_name ? `${row.name}, ${row.parent_name}` : row.name;
  }
}

function toItem(row: StoredPlaceRow, regionName: string): PlaceListItem[] {
  // Tọa độ Google hết hạn mà chưa lấy lại được: không hiện trên danh sách lần này.
  if (row.lat === null || row.lng === null) return [];
  const query = encodeURIComponent(`${row.name}, ${regionName}`);
  return [
    {
      id: row.id,
      name: row.name,
      category: row.category,
      address: row.address,
      coordinates: { lat: row.lat, lng: row.lng },
      description: row.description,
      openingHours: row.opening_hours,
      hours: hoursToday(row.opening_hours),
      website: null,
      sourceUrl: row.google_place_id
        ? `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${row.google_place_id}`
        : `https://www.google.com/maps/search/?api=1&query=${query}`,
      locationSource: row.location_source === 'google' ? 'google' : 'ai',
      googlePlaceId: row.google_place_id,
      articles: row.articles,
    },
  ];
}

function openingHours(hours: { open: string; close: string }): string | null {
  const { open, close } = hours;
  return HHMM.test(open) && HHMM.test(close) ? `${open}-${close}` : null;
}

function insideBbox(lat: number, lng: number, bbox: Bbox | null): boolean {
  // Ngoài Việt Nam thì chắc chắn AI đoán sai.
  if (lat < 8 || lat > 23.6 || lng < 102 || lng > 110) return false;
  if (!bbox) return true;
  const [south, west, north, east] = bbox;
  const pad = AI_LOCATION_PADDING_DEG;
  return (
    lat >= south - pad &&
    lat <= north + pad &&
    lng >= west - pad &&
    lng <= east + pad
  );
}

/** true nếu `promise` xong trong `ms`; lỗi trong thời gian đó thì ném ra. Không hủy promise. */
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

function building(): PlacesPage {
  return {
    status: 'building',
    items: [],
    attribution: ATTRIBUTION,
    source: 'web',
    sources: [],
  };
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: 'PLACES_UNAVAILABLE',
    message: 'Tạm thời không lấy được địa điểm. Hãy thử lại sau.',
  });
}
