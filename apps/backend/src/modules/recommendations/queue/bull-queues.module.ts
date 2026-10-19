import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { RedisConfig } from '../../../config/configuration.js';
import { RECOMMENDATIONS_AI_QUEUE, RECOMMENDATIONS_QUEUE } from './jobs.js';

const DAY_S = 24 * 60 * 60;
const defaultJobOptions = {
  removeOnComplete: { age: DAY_S },
  removeOnFail: { age: 7 * DAY_S },
};

/** Chỉ được import khi hàng đợi bật (ConditionalModule): khởi tạo là mở kết nối Redis. */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: config.getOrThrow<RedisConfig>('redis'),
      }),
    }),
    BullModule.registerQueue(
      { name: RECOMMENDATIONS_QUEUE, defaultJobOptions },
      { name: RECOMMENDATIONS_AI_QUEUE, defaultJobOptions },
    ),
  ],
  exports: [BullModule],
})
export class BullQueuesModule {}
