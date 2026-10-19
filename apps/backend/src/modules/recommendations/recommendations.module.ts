import { Module } from '@nestjs/common';

import { ItinerariesModule } from '../itineraries/itineraries.module.js';
import { VisitsModule } from '../visits/visits.module.js';
import { LangchainModule } from '../../langchain/langchain.module.js';
import { DraftPool } from './draft-pool.js';
import { JOB_RUNNER } from './queue/jobs.js';
import {
  RecommendationsAiProcessor,
  RecommendationsProcessor,
} from './queue/recommendations.processor.js';
import { RecommendationBuilder } from './recommendation-builder.js';
import { RecommendationJobs } from './recommendation-jobs.js';
import { RecommendationsController } from './recommendations.controller.js';
import { RecommendationsService } from './recommendations.service.js';
import { ThemeCatalog } from './theme-catalog.js';
import { ThemeGenerator } from './theme-generator.js';

/**
 * Gợi ý lịch trình ở trang chủ (spec 2026-10-19-home-recommendations). Worker
 * BullMQ chỉ được tạo khi `BullQueuesModule` được nạp (hàng đợi bật).
 */
@Module({
  imports: [ItinerariesModule, VisitsModule, LangchainModule],
  controllers: [RecommendationsController],
  providers: [
    DraftPool,
    ThemeCatalog,
    ThemeGenerator,
    RecommendationBuilder,
    RecommendationJobs,
    { provide: JOB_RUNNER, useExisting: RecommendationJobs },
    RecommendationsProcessor,
    RecommendationsAiProcessor,
    RecommendationsService,
  ],
  exports: [RecommendationJobs, JOB_RUNNER, RecommendationsService],
})
export class RecommendationsModule {}
