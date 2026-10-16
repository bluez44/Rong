import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  ArticleSource,
  GoogleContentStatus,
  GooglePlaceContent,
  LocationSource,
  PlaceCategory,
  PlaceDetail,
  PlaceImage,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import {
  GooglePlacesService,
  GoogleUnavailableError,
} from '../google/google-places.service.js';
import { hoursToday } from './opening-hours.js';

const ATTRIBUTIONS: Record<DetailRow['source'], string> = {
  google: 'Google Maps',
  web: 'Tổng hợp từ bài viết (AI) · Google Maps',
};

interface DetailRow {
  id: string;
  name: string;
  category: PlaceCategory;
  lat: number | null;
  lng: number | null;
  address: string | null;
  description: string | null;
  opening_hours: string | null;
  website: string | null;
  google_place_id: string | null;
  source: 'google' | 'web';
  location_source: LocationSource;
  articles: ArticleSource[] | null;
  image: PlaceImage | null;
}

@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly google: GooglePlacesService,
  ) {}

  /**
   * Màn hình chi tiết (F5): dữ liệu riêng của app cộng nội dung Google gọi
   * theo thời gian thực. Google lỗi hay chưa cấu hình thì vẫn trả phần dữ liệu
   * riêng, kèm `googleStatus` để client hiển thị phù hợp.
   */
  async getDetail(id: string): Promise<PlaceDetail> {
    // Không gọi Google lấy lại tọa độ: dòng đã ghép Google chỉ đường bằng
    // place_id; dòng AI có tọa độ riêng. Tọa độ Google hết hạn trả null.
    const [row] = (await this.db.query(
      `SELECT p.id, p.name, p.category,
              CASE WHEN p.location_source <> 'google' OR p.location_expires_at > now() THEN ST_Y(p.location) END AS lat,
              CASE WHEN p.location_source <> 'google' OR p.location_expires_at > now() THEN ST_X(p.location) END AS lng,
              p.address,
              p.description,
              p.tags->>'opening_hours' AS opening_hours,
              COALESCE(p.tags->>'website', p.tags->>'contact:website') AS website,
              p.google_place_id, p.source, p.location_source,
              -- Bài viết nguồn và ảnh: cùng một dòng danh sách của vùng có địa điểm này (hạng cao nhất).
              top.articles, top.image
         FROM places p
         LEFT JOIN LATERAL (
           SELECT rp.articles, rp.image FROM region_places rp
            WHERE rp.place_id = p.id ORDER BY rp.rank LIMIT 1
         ) top ON true
        WHERE p.id = $1`,
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
    const item = toListItem(row, content);
    if (row.source === 'google' && content?.name) {
      // Tên trong places là của người chia sẻ đầu tiên: có tên Google thì hiện tên đó (trực tiếp, không lưu).
      item.name = content.name;
    }
    return {
      ...item,
      id: row.id,
      attribution: ATTRIBUTIONS[row.source],
      googleStatus: status,
      google: content,
    };
  }

  private async googleContent(row: DetailRow): Promise<{
    status: GoogleContentStatus;
    content: GooglePlaceContent | null;
  }> {
    // Chưa ghép được Google (tọa độ AI): không gọi Google.
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

function toListItem(
  row: DetailRow,
  content: GooglePlaceContent | null,
): Omit<PlaceDetail, 'attribution' | 'googleStatus' | 'google'> {
  const query = encodeURIComponent(row.name);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    coordinates:
      row.lat === null || row.lng === null
        ? null
        : { lat: Number(row.lat), lng: Number(row.lng) },
    address: row.source === 'google' ? null : row.address,
    googlePlaceId: row.google_place_id,
    description: row.description,
    openingHours: row.opening_hours,
    website: row.website,
    hours: hoursToday(row.opening_hours),
    sourceUrl:
      content?.googleMapsUri ??
      (row.google_place_id
        ? `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${row.google_place_id}`
        : `https://www.google.com/maps/search/?api=1&query=${query}`),
    locationSource: row.location_source,
    articles: row.articles ?? [],
    image: row.image ?? null,
  };
}
