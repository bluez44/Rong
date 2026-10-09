import type { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OpenDataConfig } from '../../config/configuration.js';
import { PlacesWarmer } from './places-warmer.js';
import type { PlacesService } from './places.service.js';

const config = (placesWarmup: boolean) =>
  ({ placesWarmup }) as unknown as OpenDataConfig;

function setup(warm: (id: string) => Promise<boolean>, enabled = true) {
  const db = {
    query: vi.fn(async () => [
      { id: 'a', name: 'Đà Lạt' },
      { id: 'b', name: 'Huế' },
      { id: 'c', name: 'Lâm Đồng' },
    ]),
  } as unknown as DataSource;
  const warmMock = vi.fn(warm);
  const places = { warm: warmMock } as unknown as PlacesService;
  return {
    warmer: new PlacesWarmer(db, places, config(enabled)),
    warm: warmMock,
  };
}

afterEach(() => vi.useRealTimers());

describe('PlacesWarmer', () => {
  it('dựng lần lượt từng vùng; một vùng lỗi không dừng cả lượt', async () => {
    const { warmer, warm } = setup(async (id) => {
      if (id === 'b') throw new Error('Overpass 504');
      return true;
    });

    await warmer.sweep();

    expect(warm.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c']);
  });

  it('tắt PLACES_WARMUP thì không hẹn lượt nào', () => {
    vi.useFakeTimers();
    const { warmer, warm } = setup(async () => true, false);

    warmer.onApplicationBootstrap();
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(warm).not.toHaveBeenCalled();
  });

  it('bật thì chạy sau khi khởi động một lúc, tắt app thì hủy', async () => {
    vi.useFakeTimers();
    const { warmer, warm } = setup(async () => false);

    warmer.onApplicationBootstrap();
    expect(warm).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(warm).toHaveBeenCalledTimes(3);

    warmer.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000);
    expect(warm).toHaveBeenCalledTimes(3);
  });
});
