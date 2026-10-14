import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  GooglePlaceHit,
  GooglePlacePreviewResponse,
  PlaceCategory,
  PlaceSearchHit,
  PlaceSearchResponse,
  SaveGooglePlaceResponse,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import type { PlaceSearchConfig } from '../../config/configuration.js';
import {
  GooglePlacesService,
  GoogleUnavailableError,
} from '../google/google-places.service.js';
import { RegionAreaService } from '../regions/region-area.service.js';
import { SavedPlacesService } from '../saved-places/saved-places.service.js';
import type { SaveGooglePlaceDto } from './dto/save-google-place.dto.js';
import { categoryFromGoogleType } from './google-category.js';
import { isValidGooglePlaceId } from './google-place-id.js';
import { GooglePlaceRowsService } from './google-place-rows.service.js';
import { PlaceSearchLimiter } from './place-search-limiter.js';

export const PLACE_SEARCH_CONFIG = 'PLACE_SEARCH_CONFIG';

const CATALOG_LIMIT = 10;
const GOOGLE_LIMIT = 5;
const MIN_SIMILARITY = 0.3;

interface HitRow {
  id: string;
  name: string;
  category: PlaceCategory;
  source: 'osm' | 'google' | 'web';
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Tìm địa điểm theo tên trong một vùng: danh sách của vùng khi gõ, Google Maps
 * khi bấm tìm; xem trước và lưu kết quả Google (vào "Muốn đi" nếu muốn). Không lưu nội dung
 * Google; không xếp hạng trên dữ liệu Google (PRD 7.4).
 */
@Injectable()
export class PlaceSearchService {
  private readonly logger = new Logger(PlaceSearchService.name);
  private readonly limiter: PlaceSearchLimiter;
  /** Lượt xem trước/lưu phải gọi Google (Place Details) — tính riêng với lượt tìm. */
  private readonly detailsLimiter: PlaceSearchLimiter;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly areas: RegionAreaService,
    private readonly google: GooglePlacesService,
    private readonly googleRows: GooglePlaceRowsService,
    private readonly saved: SavedPlacesService,
    @Inject(PLACE_SEARCH_CONFIG) config: PlaceSearchConfig,
  ) {
    this.limiter = new PlaceSearchLimiter(config.dailyLimit);
    this.detailsLimiter = new PlaceSearchLimiter(config.detailsDailyLimit);
  }

  async search(
    userId: string,
    regionId: string,
    q: string,
    online: boolean,
  ): Promise<PlaceSearchResponse> {
    await this.requireRegion(regionId);
    const bbox = await this.areas.ensure(regionId);
    // Chỉ tính lượt khi thật sự gọi Google.
    const useGoogle = online && this.google.enabled;
    if (useGoogle && !this.limiter.tryConsume(userId)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'PLACE_SEARCH_LIMIT',
          message:
            'Bạn đã tìm trên Google Maps nhiều lần hôm nay. Thử lại sau nhé.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const query = q.trim();

    const catalog = (await this.db.query(
      `WITH nq AS (SELECT unaccent(lower($1)) AS q)
       SELECT p.id, p.name, p.category, p.source, p.google_place_id,
              ST_Y(p.location) AS lat, ST_X(p.location) AS lng
         FROM places p, nq
        WHERE p.source = 'web' AND p.location IS NOT NULL
          AND p.location && ST_MakeEnvelope($2, $3, $4, $5, 4326)
          AND (similarity(unaccent(lower(p.name)), nq.q) >= $6
               OR position(nq.q IN unaccent(lower(p.name))) > 0)
        ORDER BY similarity(unaccent(lower(p.name)), nq.q) DESC, p.id
        LIMIT $7`,
      [
        query,
        bbox[1],
        bbox[0],
        bbox[3],
        bbox[2],
        MIN_SIMILARITY,
        CATALOG_LIMIT,
      ],
    )) as HitRow[];

    let google: GooglePlaceHit[] | null = null;
    let existing: PlaceSearchHit[] = [];
    if (useGoogle) {
      try {
        const hits = await this.google.searchByName(query, bbox, GOOGLE_LIMIT);
        const known = await this.byGoogleIds(hits.map((h) => h.googlePlaceId));
        // Dòng Google: tên trong DB do người khác đặt — hiện tên Google trực
        // tiếp; Google không trả tên thì để hit ở danh sách Google, không lộ
        // tên người khác.
        const existingRow = (h: GooglePlaceHit): HitRow | null => {
          const row = known.get(h.googlePlaceId);
          if (!row) return null;
          return row.source !== 'google' || h.name !== null ? row : null;
        };
        existing = hits.flatMap((h) => {
          const row = existingRow(h);
          if (!row) return [];
          return [toHit(row, row.source === 'google' ? h.name! : row.name)];
        });
        google = hits.filter((h) => !existingRow(h));
      } catch (error) {
        if (!(error instanceof GoogleUnavailableError)) throw error;
        // Google không trả lời được: không tính lượt của người dùng.
        this.limiter.refund(userId);
        this.logger.warn(`Tìm Google "${query}" lỗi: ${error.message}`);
        google = null;
      }
    }
    return { catalog: catalog.map((r) => toHit(r, r.name)), existing, google };
  }

  async preview(
    userId: string,
    googlePlaceId: string,
  ): Promise<GooglePlacePreviewResponse> {
    if (!isValidGooglePlaceId(googlePlaceId)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_GOOGLE_PLACE_ID',
        message: 'Mã địa điểm không hợp lệ.',
      });
    }
    const known = (await this.byGoogleIds([googlePlaceId])).get(googlePlaceId);
    if (known) return { placeId: known.id };
    if (!this.google.enabled) throw googleUnavailable();
    this.consumeDetails(userId);
    let result: Awaited<ReturnType<GooglePlacesService['preview']>>;
    try {
      result = await this.google.preview(googlePlaceId);
    } catch (error) {
      if (error instanceof GoogleUnavailableError) throw googleUnavailable();
      throw error;
    }
    if (!result) throw placeNotFound();
    return {
      googlePlaceId,
      name: result.content.name,
      address: result.content.address,
      coordinates: result.location,
      suggestedCategory: categoryFromGoogleType(result.primaryType),
      google: result.content,
    };
  }

  async save(
    userId: string,
    dto: SaveGooglePlaceDto,
  ): Promise<SaveGooglePlaceResponse> {
    // Kiểm tra vùng trước: vùng sai thì không tốn lượt gọi Google.
    await this.requireRegion(dto.regionId);
    const known = (await this.byGoogleIds([dto.googlePlaceId])).get(
      dto.googlePlaceId,
    );
    let placeId = known?.id ?? null;
    let location: { lat: number; lng: number } | null = null;
    if (!placeId) {
      if (!this.google.enabled) throw googleUnavailable();
      this.consumeDetails(userId);
      try {
        location = await this.google.locate(dto.googlePlaceId);
      } catch (error) {
        if (error instanceof GoogleUnavailableError) throw googleUnavailable();
        throw error;
      }
      if (!location) throw placeNotFound();
    }
    await this.db.transaction(async (m) => {
      if (!placeId && location) {
        placeId = await this.googleRows.upsert(
          {
            googlePlaceId: dto.googlePlaceId,
            name: dto.name,
            category: dto.category,
            lat: location.lat,
            lng: location.lng,
            fetchedAt: new Date(),
          },
          m,
        );
      }
      if (dto.addToSaved !== false) {
        await this.saved.save(
          userId,
          placeId!,
          dto.regionId,
          { source: 'search', shareImportId: null, displayName: dto.name },
          m,
        );
      }
    });
    return { placeId: placeId! };
  }

  /** Tính một lượt gọi Google Place Details; hết lượt thì 429. */
  private consumeDetails(userId: string): void {
    if (this.detailsLimiter.tryConsume(userId)) return;
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'PLACE_DETAILS_LIMIT',
        message:
          'Bạn đã xem nhiều địa điểm trên Google Maps hôm nay. Thử lại sau nhé.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Dòng `places` (danh sách từ bài viết hoặc nguồn Google) theo place_id; dòng `web` ưu tiên. */
  private async byGoogleIds(ids: string[]): Promise<Map<string, HitRow>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.db.query(
      `SELECT p.id, p.name, p.category, p.source, p.google_place_id,
              ST_Y(p.location) AS lat, ST_X(p.location) AS lng
         FROM places p
        WHERE p.google_place_id = ANY($1::text[])
        ORDER BY (p.source = 'web') DESC`,
      [ids],
    )) as HitRow[];
    const map = new Map<string, HitRow>();
    for (const row of rows) {
      if (!map.has(row.google_place_id!)) map.set(row.google_place_id!, row);
    }
    return map;
  }

  private async requireRegion(regionId: string): Promise<void> {
    const [row] = (await this.db.query(`SELECT 1 FROM regions WHERE id = $1`, [
      regionId,
    ])) as unknown[];
    if (!row) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'REGION_NOT_FOUND',
        message: 'Không tìm thấy vùng này.',
      });
    }
  }
}

function toHit(row: HitRow, name: string): PlaceSearchHit {
  return {
    id: row.id,
    name,
    category: row.category,
    coordinates:
      row.lat !== null && row.lng !== null
        ? { lat: Number(row.lat), lng: Number(row.lng) }
        : null,
  };
}

function googleUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: 'GOOGLE_UNAVAILABLE',
    message: 'Tạm thời không kết nối được Google Maps. Thử lại sau nhé.',
  });
}

function placeNotFound(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    code: 'PLACE_NOT_FOUND',
    message: 'Địa điểm này không còn trên Google Maps.',
  });
}
