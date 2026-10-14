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
  LocationSource,
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

const ATTRIBUTIONS: Record<DetailRow['source'], string> = {
  osm: '© OpenStreetMap contributors (ODbL) · Wikidata (CC0)',
  google: 'Google Maps',
  web: 'Tổng hợp từ bài viết (AI) · Google Maps',
};

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
              p.google_place_id, p.source, p.location_source
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
    if (row.source === 'google' && content?.name) {
      // Tên trong places là của người chia sẻ đầu tiên: có tên Google thì hiện tên đó (trực tiếp, không lưu).
      item.name = content.name;
    }
    if (row.source !== 'osm') {
      const query = encodeURIComponent(row.name);
      item.sourceUrl =
        content?.googleMapsUri ??
        (row.google_place_id
          ? `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${row.google_place_id}`
          : `https://www.google.com/maps/search/?api=1&query=${query}`);
    }
    return {
      ...item,
      id: row.id,
      locationSource: row.location_source,
      attribution: ATTRIBUTIONS[row.source],
      googleStatus: status,
      google: content,
    };
  }

  private async googleContent(row: DetailRow): Promise<{
    status: GoogleContentStatus;
    content: GooglePlaceContent | null;
  }> {
    // Chưa ghép được Google (tọa độ AI, dòng OSM cũ): không gọi Google.
    if (row.google_place_id === null) {
      return { status: 'not_found', content: null };
    }
    if (!this.google.enabled) return { status: 'unavailable', content: null };

    try {
      const content = await this.google.details(row.google_place_id);
      return content === null
        ? { status: 'not_found', content: null }
        : { status: 'ok', content };
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
  source: 'osm' | 'google' | 'web';
  location_source: LocationSource;
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
