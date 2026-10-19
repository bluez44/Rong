import { Injectable } from '@nestjs/common';

import type { JobRunner, RecommendationJob } from './queue/jobs.js';
import { RecommendationBuilder } from './recommendation-builder.js';

/** Chạy một job gợi ý; dùng chung cho worker BullMQ và chế độ chạy trong process. */
@Injectable()
export class RecommendationJobs implements JobRunner {
  constructor(private readonly builder: RecommendationBuilder) {}

  async run(job: RecommendationJob): Promise<unknown> {
    switch (job.name) {
      case 'build-user-set':
        return this.builder.build(
          job.data.userId,
          new Date(job.data.windowStart),
          job.data.themeKey,
        );
      default:
        throw new Error(`Chưa hỗ trợ job ${job.name}`);
    }
  }
}
