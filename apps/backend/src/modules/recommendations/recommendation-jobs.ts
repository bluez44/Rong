import { Injectable } from '@nestjs/common';

import type { JobRunner, RecommendationJob } from './queue/jobs.js';

/** Chạy một job gợi ý; dùng chung cho worker BullMQ và chế độ chạy trong process. */
@Injectable()
export class RecommendationJobs implements JobRunner {
  async run(job: RecommendationJob): Promise<unknown> {
    switch (job.name) {
      default:
        throw new Error(`Chưa hỗ trợ job ${job.name}`);
    }
  }
}
