import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_MS = 60 * 1000;

/** Xóa tọa độ Google đã quá 30 ngày khỏi `places` (PRD 7.4). */
@Injectable()
export class GoogleLocationJanitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoogleLocationJanitor.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  onModuleInit(): void {
    const run = () =>
      void this.sweep().catch((error: Error) =>
        this.logger.warn(`Dọn tọa độ Google lỗi: ${error.message}`),
      );
    this.timers.push(
      setTimeout(run, FIRST_RUN_MS).unref(),
      setInterval(run, EVERY_MS).unref(),
    );
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
  }

  async sweep(): Promise<number> {
    // Với UPDATE, DataSource.query (driver pg) trả [rows, rowCount].
    const [, count] = (await this.db.query(
      `UPDATE places SET location = NULL, location_expires_at = NULL
        WHERE location_source = 'google' AND location_expires_at <= now()`,
    )) as [unknown[], number];
    if (count > 0)
      this.logger.log(`Đã xóa tọa độ Google quá hạn của ${count} địa điểm`);
    return count;
  }
}
