import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ItinerariesModule } from '../itineraries/itineraries.module.js';
import { PlacesModule } from '../places/places.module.js';
import { VisitsModule } from '../visits/visits.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { LangchainModule } from '../../langchain/langchain.module.js';
import { DraftPool } from './draft-pool.js';
import { RecommendationMaintenance } from './maintenance.js';
import { JOB_RUNNER } from './queue/jobs.js';
import {
  RecommendationsAiProcessor,
  RecommendationsProcessor,
} from './queue/recommendations.processor.js';
import { RecommendationBuilder } from './recommendation-builder.js';
import { RecommendationJobs } from './recommendation-jobs.js';
import { RecommendationsController } from './recommendations.controller.js';
import { RecommendationsService } from './recommendations.service.js';
import { RegionImages } from './region-images.js';
import { ThemeCatalog } from './theme-catalog.js';
import { ThemeGenerator } from './theme-generator.js';
import { RECOMMENDATIONS_CONFIG, UnsplashClient } from './unsplash.client.js';

/**
 * Gợi ý lịch trình ở trang chủ (spec 2026-10-19-home-recommendations). Worker
 * BullMQ chỉ được tạo khi `BullQueuesModule` được nạp (hàng đợi bật).
 */
@Module({
  imports: [ItinerariesModule, PlacesModule, VisitsModule, LangchainModule],
  controllers: [RecommendationsController],
  providers: [
    DraftPool,
    ThemeCatalog,
    ThemeGenerator,
    RecommendationBuilder,
    RecommendationJobs,
    RecommendationMaintenance,
    { provide: JOB_RUNNER, useExisting: RecommendationJobs },
    RecommendationsProcessor,
    RecommendationsAiProcessor,
    RecommendationsService,
    UnsplashClient,
    RegionImages,
    {
      provide: RECOMMENDATIONS_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<AppConfig['recommendations']>('recommendations'),
    },
  ],
  exports: [RecommendationJobs, RecommendationMaintenance, JOB_RUNNER, RecommendationsService],
})
export class RecommendationsModule {}
