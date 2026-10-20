import { describe, expect, it, vi } from 'vitest';

import { jobIdOf, queueOf, type RecommendationJob } from './jobs.js';
import { RecommendationsQueue } from './recommendations-queue.js';

/** Hàng đợi chạy trong process (không có Redis), runner giả. */
function inlineQueue(run: (job: RecommendationJob) => Promise<unknown>) {
  const moduleRef = { get: () => ({ run }) };
  return new RecommendationsQueue(undefined, undefined, moduleRef as never);
}

const build = (themeKey = 'default'): RecommendationJob => ({
  name: 'build-user-set',
  data: { userId: 'u1', windowStart: '2026-10-19T08:00:00.000Z', themeKey },
});

describe('jobIdOf / queueOf', () => {
  it('job id cố định theo người dùng, khung giờ, chủ đề', () => {
    expect(jobIdOf(build('fixed:a'))).toBe('user_u1_2026-10-19T08-00-00-000Z_fixed-a');
  });
  it('job theo lịch không có id; job gọi Gemini vào queue AI', () => {
    expect(jobIdOf({ name: 'cleanup', data: {} })).toBeUndefined();
    expect(queueOf({ name: 'upgrade-draft', data: { draftId: 'd' } })).toBe('recommendations-ai');
    expect(queueOf({ name: 'generate-user-themes', data: { userId: 'u' } })).toBe('recommendations-ai');
    expect(queueOf(build())).toBe('recommendations');
  });
});

describe('RecommendationsQueue (chạy trong process)', () => {
  it('enqueue trùng jobId chỉ chạy một lần', async () => {
    const run = vi.fn(async () => undefined);
    const queue = inlineQueue(run);
    await Promise.all([queue.enqueue(build()), queue.enqueue(build())]);
    await queue.idle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(await queue.state(jobIdOf(build())!)).toBe('completed');
  });

  it('job lỗi → failed; remove rồi enqueue lại thì chạy lại', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('hỏng')).mockResolvedValue(undefined);
    const queue = inlineQueue(run);
    await queue.enqueue(build());
    await queue.idle();
    expect(await queue.state(jobIdOf(build())!)).toBe('failed');
    await queue.remove(jobIdOf(build())!);
    expect(await queue.state(jobIdOf(build())!)).toBe('missing');
    await queue.enqueue(build());
    await queue.idle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(await queue.state(jobIdOf(build())!)).toBe('completed');
  });

  it('idle chờ cả job do job khác đẩy vào', async () => {
    const seen: string[] = [];
    let queue!: RecommendationsQueue;
    queue = inlineQueue(async (job) => {
      seen.push(job.name);
      if (job.name === 'build-user-set') {
        await queue.enqueue({ name: 'fetch-region-image', data: { regionId: 'r' } });
      }
    });
    await queue.enqueue(build());
    await queue.idle();
    expect(seen).toEqual(['build-user-set', 'fetch-region-image']);
  });

  it('enqueue không bao giờ ném lỗi của job ra nơi gọi', async () => {
    const queue = inlineQueue(async () => {
      throw new Error('hỏng');
    });
    await expect(queue.enqueue(build())).resolves.toBeUndefined();
    await queue.idle();
  });
});

describe('RecommendationsQueue (BullMQ)', () => {
  it('Redis không phản hồi → state/enqueue/remove lỗi sau thời gian chờ, không treo', async () => {
    vi.useFakeTimers();
    try {
      const never = () => new Promise<never>(() => undefined);
      const main = { name: 'recommendations', getJob: never, addBulk: never };
      const ai = { name: 'recommendations-ai', getJob: never, addBulk: never };
      const queue = new RecommendationsQueue(main as never, ai as never, {} as never);
      const calls = [
        expect(queue.state('x')).rejects.toThrow(/Redis không phản hồi/),
        expect(queue.enqueue(build())).rejects.toThrow(/Redis không phản hồi/),
        expect(queue.remove('x')).rejects.toThrow(/Redis không phản hồi/),
      ];
      await vi.advanceTimersByTimeAsync(3_000);
      await Promise.all(calls);
    } finally {
      vi.useRealTimers();
    }
  });
});
