import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { RECOMMENDATIONS_QUEUE } from './jobs.js';

const TZ = 'Asia/Ho_Chi_Minh';

/** Lịch chạy (spec mục "Các job"). Lưu trong Redis; gọi lại khi deploy không tạo lịch trùng. */
const SCHEDULES = [
  { id: 'refresh-window', pattern: '0 6,15 * * *' },
  { id: 'refresh-themes', pattern: '0 3 * * 1' },
  { id: 'warm-featured-regions', pattern: '0 2 * * *' },
  { id: 'cleanup', pattern: '30 4 * * *' },
] as const;

@Injectable()
export class RecommendationScheduler implements OnModuleInit {
  private readonly logger = new Logger(RecommendationScheduler.name);

  constructor(
    @Optional()
    @InjectQueue(RECOMMENDATIONS_QUEUE)
    private readonly queue: Queue | undefined,
  ) {}

  onModuleInit(): void {
    if (!this.queue) {
      this.logger.log(
        'Hàng đợi gợi ý đang tắt: không có lịch làm mới 6:00/15:00.',
      );
      return;
    }
    // Không chờ: Redis không tới được thì app vẫn khởi động, chỉ thiếu lịch chạy.
    void this.register(this.queue).catch((error: unknown) =>
      this.logger.error(
        `Không đăng ký được lịch chạy gợi ý: ${(error as Error).message}`,
      ),
    );
  }

  private async register(queue: Queue): Promise<void> {
    for (const { id, pattern } of SCHEDULES) {
      await queue.upsertJobScheduler(
        id,
        { pattern, tz: TZ },
        { name: id, data: {} },
      );
    }
    this.logger.log(`Đã đăng ký ${SCHEDULES.length} lịch chạy gợi ý (${TZ}).`);
  }
}
