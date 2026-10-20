/**
 * Đẩy một job gợi ý vào BullMQ để kiểm tra tay (Redis local, `pnpm infra:up`).
 *   npx tsx scripts/enqueue-recommendation-job.ts refresh-window
 *   npx tsx scripts/enqueue-recommendation-job.ts generate-user-themes <userId>
 */
import { Queue } from 'bullmq';

const [name, arg] = process.argv.slice(2);
const AI_JOBS = new Set(['generate-user-themes', 'upgrade-draft']);
const data =
  name === 'generate-user-themes'
    ? { userId: arg }
    : name === 'upgrade-draft'
      ? { draftId: arg }
      : name === 'fetch-region-image'
        ? { regionId: arg }
        : {};

const queue = new Queue(AI_JOBS.has(name) ? 'recommendations-ai' : 'recommendations', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    ...(process.env.REDIS_TLS === 'true' && { tls: {} }),
  },
});
await queue.add(name, data);
console.log(`Đã đẩy job ${name}`, data);
await queue.close();
