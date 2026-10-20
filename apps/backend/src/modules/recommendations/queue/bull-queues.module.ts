import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';

import type { RedisConfig } from '../../../config/configuration.js';
import { RECOMMENDATIONS_AI_QUEUE, RECOMMENDATIONS_QUEUE } from './jobs.js';

const DAY_S = 24 * 60 * 60;

const defaultJobOptions = {
  removeOnComplete: { age: DAY_S },
  removeOnFail: { age: 7 * DAY_S },
};

/**
 * Kết nối Redis của worker: giữ mặc định của ioredis (hàng chờ offline, BullMQ tự đặt
 * `maxRetriesPerRequest: null`) để worker tự nối lại khi Redis quay lại. `@Processor` là
 * decorator tĩnh nên object này được điền lúc nạp cấu hình, trước khi worker được tạo.
 */
export const workerConnection: ConnectionOptions = {};

/** Chỉ được import khi hàng đợi bật (ConditionalModule): khởi tạo là mở kết nối Redis. */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redis = config.getOrThrow<RedisConfig>('redis');
        Object.assign(workerConnection, redis);
        // Queue (đẩy job, đọc trạng thái trên đường request): Redis mất kết nối thì lệnh lỗi
        // ngay thay vì chờ trong hàng offline.
        return {
          connection: {
            ...redis,
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1,
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: RECOMMENDATIONS_QUEUE, defaultJobOptions },
      { name: RECOMMENDATIONS_AI_QUEUE, defaultJobOptions },
    ),
  ],
  exports: [BullModule],
})
export class BullQueuesModule {}
