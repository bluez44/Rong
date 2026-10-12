import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  GooglePlacesService,
  GoogleUnavailableError,
} from '../google/google-places.service.js';

/** Tọa độ Google được giữ tối đa chừng này ngày (PRD 7.4, ToS 3.2.3(b)). */
export const GOOGLE_LOCATION_TTL_DAYS = 30;

/**
 * Dòng `places` nguồn Google mất tọa độ sau 30 ngày. Ai cần tọa độ (lập lịch
 * trình, chi tiết) gọi `ensure` trước: lấy lại qua Google, ghi hạn mới.
 */
@Injectable()
export class PlaceLocationService {
  private readonly logger = new Logger(PlaceLocationService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly google: GooglePlacesService,
  ) {}

  /** Lấy lại tọa độ cho dòng Google đã hết hạn trong `ids`; trả các id vẫn không có tọa độ. */
  async ensure(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const stale = (await this.db.query(
      `SELECT id, google_place_id FROM places
        WHERE id = ANY($1::uuid[]) AND source = 'google'
          AND (location IS NULL OR location_expires_at <= now())`,
      [ids],
    )) as Array<{ id: string; google_place_id: string }>;
    if (stale.length === 0) return [];
    if (!this.google.enabled) return stale.map((row) => row.id);

    const results = await Promise.allSettled(
      stale.map(async (row) => {
        const point = await this.google.locate(row.google_place_id);
        if (!point) return row.id;
        await this.db.query(
          `UPDATE places SET location = ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326),
                  location_expires_at = now() + make_interval(days => $4::int), updated_at = now()
            WHERE id = $1`,
          [row.id, point.lng, point.lat, GOOGLE_LOCATION_TTL_DAYS],
        );
        return null;
      }),
    );
    const missing: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        if (result.value) missing.push(result.value);
      } else {
        if (!(result.reason instanceof GoogleUnavailableError)) {
          this.logger.warn(
            `Làm mới tọa độ ${stale[i].id} lỗi: ${(result.reason as Error).message}`,
          );
        }
        missing.push(stale[i].id);
      }
    });
    return missing;
  }
}
