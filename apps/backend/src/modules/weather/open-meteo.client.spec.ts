import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenMeteoClient } from './open-meteo.client.js';

const daily = {
  time: ['2026-10-22'],
  weather_code: [1],
  temperature_2m_max: [30],
  temperature_2m_min: [22],
  precipitation_probability_max: [10],
};

describe('OpenMeteoClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const client = () =>
    new OpenMeteoClient({
      enabled: true,
      forecastUrl: 'https://api.open-meteo.test',
      archiveUrl: 'https://archive.open-meteo.test',
      contactEmail: 'dev@rong.local',
      climateDailyLimit: 25,
    });

  it('không xếp hàng: vùng B không phải chờ request đang treo của vùng A', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('latitude=10.0000')) {
        // Treo tới khi bị hủy.
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ daily })));
    });
    vi.stubGlobal('fetch', fetchMock);
    const c = client();
    const hanging = c.forecast(10, 106).catch(() => null);
    const started = Date.now();
    await expect(c.forecast(11, 107)).resolves.toEqual(daily);
    expect(Date.now() - started).toBeLessThan(1000);
    void hanging;
  });

  it('gửi User-Agent có liên hệ; HTTP lỗi thì ném', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response('nope', { status: 429 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().forecast(11, 107)).rejects.toThrow('429');
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get('User-Agent')).toContain('dev@rong.local');
  });
});
