import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import type { OpenDataConfig } from '../../config/configuration.js';
import { OPEN_DATA_CONFIG } from '../open-data/open-data.service.js';
import { PlacesService } from './places.service.js';

/** Chờ chừng này sau khi khởi động, để RegionSeeder chạy xong và app nhận request trước. */
const START_DELAY_MS = 30_000;
/** Mỗi chừng này lại quét các vùng chưa có hoặc đã quá hạn. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Dựng sẵn danh mục địa điểm (FR-1.10: "tổng hợp sẵn") cho các vùng đã seed,
 * để người dùng mở vùng chỉ còn một truy vấn DB thay vì chờ Overpass, Wikidata.
 *
 * Chạy tuần tự từng vùng: Overpass công cộng giới hạn tần suất, và
 * ThrottledHttp cũng xếp hàng theo host. Thứ tự: điểm đến (khung nhỏ, được
 * mở nhiều), tỉnh hiện hành, rồi tỉnh cũ. Vùng nhập từ Nominatim (xã, phường…)
 * vẫn tải khi có người mở lần đầu.
 */
@Injectable()
export class PlacesWarmer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PlacesWarmer.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly places: PlacesService,
    @Inject(OPEN_DATA_CONFIG) private readonly config: OpenDataConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.placesWarmup) return;
    this.schedule(START_DELAY_MS);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.sweep().finally(() => this.schedule(SWEEP_INTERVAL_MS));
    }, delayMs);
    this.timer.unref();
  }

  /** Một lượt quét. Lỗi ở một vùng chỉ ghi log, không dừng cả lượt. */
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const started = Date.now();
    let refreshed = 0;
    let failed = 0;
    try {
      const regions = (await this.db.query(
        `SELECT id, name FROM regions
          WHERE source_key LIKE 'vn:%'
            AND (type = 'destination' OR level = 'province')
          ORDER BY CASE WHEN type = 'destination' THEN 0
                        WHEN boundary_version = 'current' THEN 1
                        ELSE 2 END, name`,
      )) as Array<{ id: string; name: string }>;

      for (const region of regions) {
        if (this.stopped) break;
        try {
          if (await this.places.warm(region.id)) refreshed++;
        } catch (error) {
          failed++;
          this.logger.warn(
            `Không dựng sẵn được "${region.name}": ${(error as Error).message}`,
          );
        }
      }
      if (refreshed > 0 || failed > 0) {
        this.logger.log(
          `Dựng sẵn danh mục: ${refreshed} vùng tải mới, ${failed} lỗi, trong ${Math.round((Date.now() - started) / 1000)} s`,
        );
      }
    } catch (error) {
      this.logger.error('Lượt dựng sẵn danh mục lỗi', error as Error);
    } finally {
      this.running = false;
    }
  }
}
