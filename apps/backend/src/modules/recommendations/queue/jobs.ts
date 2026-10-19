export const RECOMMENDATIONS_QUEUE = 'recommendations';
/** Job gọi Gemini: queue riêng để limiter không chặn job thường. */
export const RECOMMENDATIONS_AI_QUEUE = 'recommendations-ai';

type Empty = Record<string, never>;

export type RecommendationJob =
  | {
      name: 'build-user-set';
      data: { userId: string; windowStart: string; themeKey: string };
    }
  | { name: 'generate-user-themes'; data: { userId: string } }
  | { name: 'upgrade-draft'; data: { draftId: string } }
  | { name: 'fetch-region-image'; data: { regionId: string } }
  | { name: 'refresh-window'; data: Empty }
  | { name: 'refresh-themes'; data: Empty }
  | { name: 'warm-featured-regions'; data: Empty }
  | { name: 'cleanup'; data: Empty };

export type JobState = 'missing' | 'waiting' | 'active' | 'completed' | 'failed';

export interface JobRunner {
  run(job: RecommendationJob): Promise<unknown>;
}

/** Token của bộ chạy job (RecommendationJobs). Hàng đợi lấy qua ModuleRef để không import vòng. */
export const JOB_RUNNER = 'RECOMMENDATION_JOB_RUNNER';

/** BullMQ không cho dấu ":" trong job id tự đặt; đổi ký tự lạ thành "-". */
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '-');

/** Job id cố định để không chạy trùng; undefined = job theo lịch, không cần chống trùng. */
export function jobIdOf(
  job: RecommendationJob,
  now: Date = new Date(),
): string | undefined {
  switch (job.name) {
    case 'build-user-set':
      return `user_${job.data.userId}_${safe(job.data.windowStart)}_${safe(job.data.themeKey)}`;
    case 'generate-user-themes':
      return `themes_${job.data.userId}_${now.toISOString().slice(0, 10)}`;
    case 'upgrade-draft':
      return `upgrade_${job.data.draftId}`;
    case 'fetch-region-image':
      return `image_${job.data.regionId}`;
    default:
      return undefined;
  }
}

export function queueOf(
  job: RecommendationJob,
): typeof RECOMMENDATIONS_QUEUE | typeof RECOMMENDATIONS_AI_QUEUE {
  return job.name === 'upgrade-draft' || job.name === 'generate-user-themes'
    ? RECOMMENDATIONS_AI_QUEUE
    : RECOMMENDATIONS_QUEUE;
}

/** Số lần chạy và backoff theo bảng job của spec. */
export function attemptsOf(job: RecommendationJob): {
  attempts: number;
  backoff?: { type: 'fixed'; delay: number };
} {
  switch (job.name) {
    case 'refresh-window':
      return { attempts: 3, backoff: { type: 'fixed', delay: 30_000 } };
    case 'build-user-set':
      return { attempts: 2, backoff: { type: 'fixed', delay: 5_000 } };
    case 'upgrade-draft':
    case 'generate-user-themes':
    case 'fetch-region-image':
      return { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } };
    default:
      return { attempts: 1 };
  }
}
