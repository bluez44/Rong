import { Module } from '@nestjs/common';

import { JOB_RUNNER } from './queue/jobs.js';
import {
  RecommendationsAiProcessor,
  RecommendationsProcessor,
} from './queue/recommendations.processor.js';
import { RecommendationJobs } from './recommendation-jobs.js';

/**
 * Gợi ý lịch trình ở trang chủ (spec 2026-10-19-home-recommendations). Worker
 * BullMQ chỉ được tạo khi `BullQueuesModule` được nạp (hàng đợi bật).
 */
@Module({
  providers: [
    RecommendationJobs,
    { provide: JOB_RUNNER, useExisting: RecommendationJobs },
    RecommendationsProcessor,
    RecommendationsAiProcessor,
  ],
  exports: [RecommendationJobs, JOB_RUNNER],
})
export class RecommendationsModule {}
