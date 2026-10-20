import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Queue } from 'bullmq';

import {
  attemptsOf,
  JOB_RUNNER,
  jobIdOf,
  queueOf,
  RECOMMENDATIONS_AI_QUEUE,
  RECOMMENDATIONS_QUEUE,
  type JobRunner,
  type JobState,
  type RecommendationJob,
} from './jobs.js';

/** Lệnh Redis trên đường request chờ tối đa chừng này rồi lỗi (Redis tắt, chưa nối được). */
const REDIS_TIMEOUT_MS = 3_000;

/** BullMQ chờ Redis "ready" vô hạn trước mỗi lệnh; bọc lại để nơi gọi nhận lỗi thay vì treo. */
function withTimeout<T>(what: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Redis không phản hồi (${what}) sau ${REDIS_TIMEOUT_MS} ms`,
          ),
        ),
      REDIS_TIMEOUT_MS,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Cửa duy nhất để đẩy job gợi ý. Có BullMQ (Redis) thì đẩy vào queue; không có
 * (e2e, máy không chạy Redis) thì chạy ngay trong process, vẫn chống trùng theo
 * job id như BullMQ.
 */
@Injectable()
export class RecommendationsQueue {
  private readonly logger = new Logger(RecommendationsQueue.name);
  private readonly inline = new Map<string, JobState>();
  private readonly running = new Set<Promise<void>>();
  private anonymous = 0;

  constructor(
    @Optional()
    @InjectQueue(RECOMMENDATIONS_QUEUE)
    private readonly main: Queue | undefined,
    @Optional()
    @InjectQueue(RECOMMENDATIONS_AI_QUEUE)
    private readonly ai: Queue | undefined,
    private readonly moduleRef: ModuleRef,
  ) {}

  get usesRedis(): boolean {
    return this.main !== undefined && this.ai !== undefined;
  }

  async enqueue(
    job: RecommendationJob,
    opts: { priority?: number } = {},
  ): Promise<void> {
    await this.enqueueMany([job], opts);
  }

  async enqueueMany(
    jobs: RecommendationJob[],
    opts: { priority?: number } = {},
  ): Promise<void> {
    if (jobs.length === 0) return;
    if (this.main && this.ai) {
      for (const target of [this.main, this.ai]) {
        const batch = jobs.filter((j) => queueOf(j) === target.name);
        if (batch.length === 0) continue;
        await withTimeout(
          'addBulk',
          target.addBulk(
            batch.map((job) => ({
              name: job.name,
              data: job.data,
              opts: {
                jobId: jobIdOf(job),
                priority: opts.priority,
                ...attemptsOf(job),
              },
            })),
          ),
        );
      }
      return;
    }
    for (const job of jobs) this.runInline(job);
  }

  async state(jobId: string): Promise<JobState> {
    if (!this.main || !this.ai) return this.inline.get(jobId) ?? 'missing';
    for (const queue of [this.main, this.ai]) {
      const job = await withTimeout('getJob', queue.getJob(jobId));
      if (!job) continue;
      const state = await withTimeout('getState', job.getState());
      if (state === 'completed' || state === 'failed' || state === 'active')
        return state;
      return 'waiting';
    }
    return 'missing';
  }

  async remove(jobId: string): Promise<void> {
    if (!this.main || !this.ai) {
      this.inline.delete(jobId);
      return;
    }
    for (const queue of [this.main, this.ai]) {
      const job = await withTimeout('getJob', queue.getJob(jobId));
      if (job) await withTimeout('remove', job.remove());
    }
  }

  /** Chỉ chế độ chạy trong process: chờ mọi job đang chạy (kể cả job do job khác đẩy). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled(this.running);
  }

  /**
   * Khác biệt với BullMQ (chấp nhận được):
   * - Job `completed` không tự hết hạn sau 1 ngày; chỉ ảnh hưởng một process chạy lâu với
   *   `RECOMMENDATIONS_ENABLED=false`, và mỗi khung giờ dùng job id khác nên không kẹt.
   * - Job `failed` KHÔNG chặn enqueue lại (BullMQ coi enqueue lại một jobId đang `failed` là
   *   no-op, giữ nguyên job cũ). Ở đây enqueue lại sau khi lỗi mà không gọi `remove()` trước sẽ
   *   chạy lại ngay — cách retry đơn giản cho chế độ trong process, không cần remove() trước.
   */
  private runInline(job: RecommendationJob): void {
    const id = jobIdOf(job) ?? `anonymous_${++this.anonymous}`;
    const current = this.inline.get(id);
    if (
      current === 'waiting' ||
      current === 'active' ||
      current === 'completed'
    )
      return;
    this.inline.set(id, 'active');
    const runner = this.moduleRef.get<JobRunner>(JOB_RUNNER, {
      strict: false,
    });
    const task = (async () => {
      try {
        await runner.run(job);
        this.inline.set(id, 'completed');
      } catch (error) {
        this.inline.set(id, 'failed');
        this.logger.warn(
          `Job ${job.name} (${id}) lỗi: ${(error as Error).message}`,
        );
      }
    })();
    this.running.add(task);
    void task.finally(() => this.running.delete(task));
  }
}
