import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { RecommendationJobs } from '../recommendation-jobs.js';
import { workerConnection } from './bull-queues.module.js';
import {
  RECOMMENDATIONS_AI_QUEUE,
  RECOMMENDATIONS_QUEUE,
  type RecommendationJob,
} from './jobs.js';

const toJob = (job: Job) =>
  ({ name: job.name, data: job.data }) as RecommendationJob;

@Processor(RECOMMENDATIONS_QUEUE, {
  concurrency: 4,
  connection: workerConnection,
})
export class RecommendationsProcessor extends WorkerHost {
  constructor(private readonly jobs: RecommendationJobs) {
    super();
  }

  process(job: Job): Promise<unknown> {
    return this.jobs.run(toJob(job));
  }
}

/** Job gọi Gemini: tối đa 10 job mỗi phút. */
@Processor(RECOMMENDATIONS_AI_QUEUE, {
  concurrency: 2,
  connection: workerConnection,
  limiter: { max: 10, duration: 60_000 },
})
export class RecommendationsAiProcessor extends WorkerHost {
  constructor(private readonly jobs: RecommendationJobs) {
    super();
  }

  process(job: Job): Promise<unknown> {
    return this.jobs.run(toJob(job));
  }
}
