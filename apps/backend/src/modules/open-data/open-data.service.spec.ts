import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenDataError } from './http.js';
import { OpenDataService } from './open-data.service.js';

const service = () =>
  new OpenDataService({
    nominatimUrl: 'http://nominatim.test',
    contactEmail: 'dev@rong.vn',
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lỗi mạng', () => {
  it('nêu rõ host và lý do (ví dụ DNS) thay vì "fetch failed"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: {
            code: 'ENOTFOUND',
            message: 'getaddrinfo ENOTFOUND nominatim.test',
          },
        });
      }),
    );

    const error = await service()
      .searchPlaces('đà lạt')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenDataError);
    expect((error as Error).message).toBe(
      'Không kết nối được nominatim.test (ENOTFOUND)',
    );
  });
});
