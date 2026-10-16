import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { PlaceCategory } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { GOOGLE_LOCATION_TTL_DAYS } from './place-location.service.js';

export interface GooglePlaceRowInput {
  googlePlaceId: string;
  /** Tên do người dùng đặt / lấy từ nội dung người dùng — không phải tên Google. */
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  /** Lúc lấy tọa độ từ Google; hạn tọa độ = fetchedAt + GOOGLE_LOCATION_TTL_DAYS. */
  fetchedAt: Date;
}

/**
 * Dòng `places` nguồn Google (F4, tìm địa điểm): chỉ `google_place_id`, tên do
 * người dùng đặt và tọa độ hạn 30 ngày tính từ lúc lấy (PRD 7.4). Dùng chung
 * theo place_id; dòng đã có tọa độ hạn lâu hơn thì giữ nguyên; không đổi tên
 * hay loại của dòng đã có. Trùng place_id với một dòng `web` thì dùng lại dòng đó.
 */
@Injectable()
export class GooglePlaceRowsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async upsert(
    input: GooglePlaceRowInput,
    runner: Pick<DataSource, 'query'> = this.db,
  ): Promise<string> {
    const [row] = (await runner.query(
      `INSERT INTO places (source, google_place_id, name, category, location, location_source, location_expires_at)
       VALUES ('google', $1, $2, $3::place_category, ST_SetSRID(ST_MakePoint($4::float8, $5::float8), 4326), 'google',
               $7::timestamptz + make_interval(days => $6::int))
       ON CONFLICT (google_place_id) WHERE source IN ('google', 'web')
       DO UPDATE SET
         location = CASE WHEN places.location IS NULL OR EXCLUDED.location_expires_at > places.location_expires_at
                         THEN EXCLUDED.location ELSE places.location END,
         location_expires_at = CASE WHEN places.location IS NULL OR EXCLUDED.location_expires_at > places.location_expires_at
                                    THEN EXCLUDED.location_expires_at ELSE places.location_expires_at END,
         updated_at = now()
       RETURNING id`,
      [
        input.googlePlaceId,
        input.name,
        input.category,
        input.lng,
        input.lat,
        GOOGLE_LOCATION_TTL_DAYS,
        input.fetchedAt,
      ],
    )) as Array<{ id: string }>;
    return row.id;
  }
}
