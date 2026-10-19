import { Global, Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';

import { recommendationsQueueEnabled } from '../../../config/configuration.js';
import { BullQueuesModule } from './bull-queues.module.js';
import { RecommendationScheduler } from './recommendation-scheduler.js';
import { RecommendationsQueue } from './recommendations-queue.js';

/** Global: UsersModule, VisitsModule đẩy job mà không phải import RecommendationsModule. */
@Global()
@Module({
  imports: [
    ConditionalModule.registerWhen(BullQueuesModule, (env) =>
      recommendationsQueueEnabled(env),
    ),
  ],
  providers: [RecommendationsQueue, RecommendationScheduler],
  exports: [RecommendationsQueue],
})
export class RecommendationsQueueModule {}
