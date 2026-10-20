import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from './configuration.js';

describe('loadConfig: hạn mức tìm địa điểm', () => {
  beforeEach(() => {
    vi.stubEnv('DB_HOST', 'localhost');
    vi.stubEnv('DB_PORT', '5432');
    vi.stubEnv('DB_USERNAME', 'u');
    vi.stubEnv('DB_PASSWORD', 'p');
    vi.stubEnv('DB_DATABASE', 'd');
    vi.stubEnv('JWT_SECRET', 'x'.repeat(32));
    vi.stubEnv('PLACE_SEARCH_DAILY_LIMIT', '');
    vi.stubEnv('PLACE_DETAILS_DAILY_LIMIT', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('mặc định 60 lượt tìm và 150 lượt xem', () => {
    expect(loadConfig().placeSearch).toEqual({
      dailyLimit: 60,
      detailsDailyLimit: 150,
    });
  });

  it('đọc giá trị từ biến môi trường', () => {
    vi.stubEnv('PLACE_SEARCH_DAILY_LIMIT', '5');
    vi.stubEnv('PLACE_DETAILS_DAILY_LIMIT', '7');
    expect(loadConfig().placeSearch).toEqual({
      dailyLimit: 5,
      detailsDailyLimit: 7,
    });
  });

  it.each([
    ['PLACE_SEARCH_DAILY_LIMIT', '0'],
    ['PLACE_SEARCH_DAILY_LIMIT', '-3'],
    ['PLACE_SEARCH_DAILY_LIMIT', 'abc'],
    ['PLACE_DETAILS_DAILY_LIMIT', '1.5'],
    ['PLACE_DETAILS_DAILY_LIMIT', '0'],
  ])('%s=%s → lỗi khi khởi động', (key, value) => {
    vi.stubEnv(key, value);
    expect(() => loadConfig()).toThrow(key);
  });
});

describe('loadConfig: kết nối Redis', () => {
  beforeEach(() => {
    vi.stubEnv('DB_HOST', 'localhost');
    vi.stubEnv('DB_PORT', '5432');
    vi.stubEnv('DB_USERNAME', 'u');
    vi.stubEnv('DB_PASSWORD', 'p');
    vi.stubEnv('DB_DATABASE', 'd');
    vi.stubEnv('JWT_SECRET', 'x'.repeat(32));
    vi.stubEnv('REDIS_HOST', '');
    vi.stubEnv('REDIS_PORT', '');
    vi.stubEnv('REDIS_USERNAME', '');
    vi.stubEnv('REDIS_PASSWORD', '');
    vi.stubEnv('REDIS_TLS', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('mặc định localhost:6379, không mật khẩu, không TLS', () => {
    expect(loadConfig().redis).toEqual({ host: 'localhost', port: 6379 });
  });

  it('Redis Cloud: user, mật khẩu và TLS', () => {
    vi.stubEnv('REDIS_HOST', 'redis-1.cloud.redislabs.com');
    vi.stubEnv('REDIS_PORT', '12345');
    vi.stubEnv('REDIS_USERNAME', 'default');
    vi.stubEnv('REDIS_PASSWORD', 'bi-mat');
    vi.stubEnv('REDIS_TLS', 'true');
    expect(loadConfig().redis).toEqual({
      host: 'redis-1.cloud.redislabs.com',
      port: 12345,
      username: 'default',
      password: 'bi-mat',
      tls: {},
    });
  });
});
