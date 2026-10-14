import {
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
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import {
  GooglePlacesService,
  GoogleUnavailableError,
} from '../google/google-places.service.js';
import { hoursToday } from './opening-hours.js';
import { PlaceLocationService } from './place-location.service.js';

export const ATTRIBUTION =
  '© OpenStreetMap contributors (ODbL) · Wikidata (CC0)';

/** Địa điểm chưa ghép được với Google thì sau chừng này mới thử lại (quán mới mở có thể đã lên Google). */
const GOOGLE_REMATCH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

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

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly google: GooglePlacesService,
    private readonly locations: PlaceLocationService,
  ) {}

  /**
   * Màn hình chi tiết (F5): dữ liệu riêng của app cộng nội dung Google gọi
   * theo thời gian thực. Google lỗi hay chưa cấu hình thì vẫn trả phần dữ liệu
   * riêng, kèm `googleStatus` để client hiển thị phù hợp.
   */
  async getDetail(id: string): Promise<PlaceDetail> {
    const missing = await this.locations.ensure([id]);
    if (missing.length > 0) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'PLACE_LOCATION_UNAVAILABLE',
        message:
          'Tạm thời không tải được vị trí địa điểm này. Hãy thử lại sau.',
      });
    }
    const [row] = (await this.db.query(
      `SELECT p.id, p.name, p.category, ST_Y(p.location) AS lat, ST_X(p.location) AS lng,
              p.composite_score, p.description, p.wikidata_id, p.osm_type, p.osm_id,
              p.tags->>'opening_hours' AS opening_hours,
              COALESCE(p.tags->>'website', p.tags->>'contact:website') AS website,
              p.google_place_id, p.google_matched_at, p.source
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
    const item = toListItem(row);
    if (row.source === 'google') {
      // Tên trong places là của người chia sẻ đầu tiên: có tên Google thì hiện tên đó (trực tiếp, không lưu).
      if (content?.name) item.name = content.name;
      item.sourceUrl =
        content?.googleMapsUri ??
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.name)}&query_place_id=${row.google_place_id}`;
    }
    return {
      ...item,
      id: row.id,
      attribution: row.source === 'google' ? 'Google Maps' : ATTRIBUTION,
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

      if (placeId === null && retryDue && row.source !== 'google') {
        placeId = await this.google.matchPlaceId(row.name, row.lat, row.lng);
        await this.db.query(
          `UPDATE places SET google_place_id = $2, google_matched_at = now() WHERE id = $1`,
          [row.id, placeId],
        );
      }
      if (placeId === null) return { status: 'not_found', content: null };

      const content = await this.google.details(placeId);
      if (content === null) {
        // Dòng Google không được gỡ place_id (chk_place_source).
        if (row.source === 'google')
          return { status: 'not_found', content: null };
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
}

interface DetailRow extends PlaceRow {
  google_place_id: string | null;
  google_matched_at: Date | null;
  source: 'osm' | 'google';
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
