import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig, recommendationsQueueEnabled } from './configuration.js';

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
    vi.stubEnv('REDIS_URL', '');
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

  it('REDIS_URL thay cho các biến lẻ', () => {
    vi.stubEnv('REDIS_HOST', 'bi-bo-qua');
    vi.stubEnv('REDIS_URL', 'redis://default:p%40ss@db.redis.io:15078');
    expect(loadConfig().redis).toEqual({
      host: 'db.redis.io',
      port: 15078,
      username: 'default',
      password: 'p@ss',
    });
  });

  it('rediss:// bật TLS, thiếu cổng thì 6379', () => {
    vi.stubEnv('REDIS_URL', 'rediss://:pw@db.redis.io');
    expect(loadConfig().redis).toEqual({
      host: 'db.redis.io',
      port: 6379,
      password: 'pw',
      tls: {},
    });
  });

  it('REDIS_URL sai định dạng thì báo lỗi', () => {
    vi.stubEnv('REDIS_URL', 'http://db.redis.io');
    expect(() => loadConfig()).toThrow(/REDIS_URL/);
  });
});

describe('recommendationsQueueEnabled', () => {
  it('production bật khi có REDIS_URL hoặc REDIS_HOST', () => {
    expect(recommendationsQueueEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(
      recommendationsQueueEnabled({
        NODE_ENV: 'production',
        REDIS_URL: 'redis://h:1',
      }),
    ).toBe(true);
    expect(
      recommendationsQueueEnabled({ NODE_ENV: 'production', REDIS_HOST: 'h' }),
    ).toBe(true);
    expect(
      recommendationsQueueEnabled({
        NODE_ENV: 'production',
        REDIS_URL: 'redis://h:1',
        RECOMMENDATIONS_ENABLED: 'false',
      }),
    ).toBe(false);
  });
});

describe('loadConfig: admin', () => {
  beforeEach(() => {
    vi.stubEnv('DB_HOST', 'localhost');
    vi.stubEnv('DB_PORT', '5432');
    vi.stubEnv('DB_USERNAME', 'u');
    vi.stubEnv('DB_PASSWORD', 'p');
    vi.stubEnv('DB_DATABASE', 'd');
    vi.stubEnv('JWT_SECRET', 'x'.repeat(32));
    vi.stubEnv('ADMIN_EMAILS', '');
    vi.stubEnv('ADMIN_API_KEY', '');
    vi.stubEnv('ADMIN_REFRESH_DAILY_LIMIT', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('mặc định tắt: không email, không khóa, 30 lần mỗi ngày', () => {
    expect(loadConfig().admin).toEqual({
      emails: [],
      apiKey: null,
      refreshDailyLimit: 30,
    });
  });

  it('email viết thường, bỏ khoảng trắng và mục rỗng', () => {
    vi.stubEnv('ADMIN_EMAILS', ' Admin@Rong.VN , ,boss@example.com');
    vi.stubEnv('ADMIN_API_KEY', 'k'.repeat(32));
    vi.stubEnv('ADMIN_REFRESH_DAILY_LIMIT', '5');
    expect(loadConfig().admin).toEqual({
      emails: ['admin@rong.vn', 'boss@example.com'],
      apiKey: 'k'.repeat(32),
      refreshDailyLimit: 5,
    });
  });

  it('khóa ngắn hơn 32 ký tự thì lỗi khi khởi động', () => {
    vi.stubEnv('ADMIN_API_KEY', 'ngan-qua');
    expect(() => loadConfig()).toThrow('ADMIN_API_KEY');
  });
});
