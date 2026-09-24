import { Logger } from '@nestjs/common';

/**
 * Gọi HTTP tới dịch vụ dữ liệu mở, có giãn cách tối thiểu giữa hai request
 * cùng host. Instance công cộng của OSM chặn client gọi dồn dập (Nominatim:
 * tối đa 1 request/giây), nên các request được xếp hàng tuần tự theo host.
 */
export class ThrottledHttp {
  private readonly logger = new Logger('OpenDataHttp');
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly userAgent: string,
    private readonly minIntervalMs: Record<string, number>,
  ) {}

  async getJson<T>(
    url: string,
    init: RequestInit = {},
    timeoutMs = 30_000,
  ): Promise<T> {
    const host = new URL(url).host;
    const interval = this.minIntervalMs[host] ?? 0;

    const previous = this.queues.get(host) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          return await this.request<T>(url, init, timeoutMs);
        } finally {
          await new Promise((resolve) => setTimeout(resolve, interval));
        }
      });
    this.queues.set(host, run);
    return run;
  }

  private async request<T>(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('User-Agent', this.userAgent);
    headers.set('Accept', 'application/json');
    const response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(
        `${init.method ?? 'GET'} ${url} → ${response.status} ${body.slice(0, 200)}`,
      );
      throw new OpenDataError(
        `${new URL(url).host} trả về HTTP ${response.status}`,
      );
    }
    return (await response.json()) as T;
  }
}

export class OpenDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenDataError';
  }
}
