import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenDataError } from './http.js';
import { OpenDataService } from './open-data.service.js';

const service = () =>
  new OpenDataService({
    nominatimUrl: 'http://nominatim.test',
    overpassUrls: [
      'http://overpass.test/api/interpreter',
      'http://mirror.test/api/interpreter',
    ],
    wikidataUrl: 'http://wikidata.test/w/api.php',
    contactEmail: 'dev@rong.vn',
    placesRefreshDays: 30,
  });

const queries: string[] = [];
function overpassReturns(...bodies: unknown[]): void {
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      queries.push(new URLSearchParams(init.body as string).get('data') ?? '');
      return new Response(
        JSON.stringify(bodies[Math.min(i++, bodies.length - 1)]),
      );
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  queries.length = 0;
});

const relation = {
  type: 'relation',
  id: 1,
  tags: { name: 'Thành phố Đà Lạt' },
};

describe('OpenDataService.listBoundaries', () => {
  it('lọc theo tên ngay trên Overpass khi có tên', async () => {
    overpassReturns({ elements: [relation] });

    await service().listBoundaries('6', '2025-06-30T00:00:00Z', 'Đà Lạt');

    expect(queries[0]).toContain('[date:"2025-06-30T00:00:00Z"]');
    expect(queries[0]).toContain('["name"~"Đà Lạt",i]');
    expect(queries[0]).toContain('out tags bb;');
  });

  it('Overpass hết giờ (HTTP 200 + remark) là lỗi, không phải danh sách rỗng', async () => {
    overpassReturns({
      elements: [],
      remark:
        'runtime error: Query timed out in "query" at line 1 after 61 seconds.',
    });

    await expect(service().listBoundaries('6')).rejects.toThrow(/timed out/);
  });

  it('không cache kết quả rỗng — lần sau hỏi lại', async () => {
    overpassReturns({ elements: [] }, { elements: [relation] });
    const s = service();

    await expect(s.listBoundaries('6')).resolves.toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    await expect(s.listBoundaries('6')).resolves.toEqual([relation]);
    expect(queries).toHaveLength(2);
  });

  it('cache kết quả khác rỗng', async () => {
    overpassReturns({ elements: [relation] });
    const s = service();

    await s.listBoundaries('4');
    await s.listBoundaries('4');
    expect(queries).toHaveLength(1);
  });

  it('thoát ký tự đặc biệt trong tên', async () => {
    overpassReturns({ elements: [] });
    await service().listBoundaries('6', undefined, 'A (B) "C"');
    expect(queries[0]).toContain('["name"~"A \\(B\\) \\"C\\"",i]');
  });
});

describe('Overpass nhiều máy chủ', () => {
  it('504 ở máy chủ đầu thì thử máy chủ kế tiếp', async () => {
    const hosts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        hosts.push(new URL(url).host);
        return hosts.length === 1
          ? new Response('<html>Gateway Timeout</html>', { status: 504 })
          : new Response(JSON.stringify({ elements: [relation] }));
      }),
    );

    await expect(
      service().listBoundaries('6', undefined, 'Đà Lạt'),
    ).resolves.toEqual([relation]);
    expect(hosts).toEqual(['overpass.test', 'mirror.test']);
  });

  it('400 (truy vấn sai) thì dừng ngay, không thử máy chủ khác', async () => {
    const fetchMock = vi.fn(
      async () => new Response('bad query', { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(service().listBoundaries('6')).rejects.toThrow(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mọi máy chủ đều lỗi thì báo lỗi của máy chủ cuối', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 504 })),
    );
    await expect(service().listBoundaries('6')).rejects.toThrow(
      /mirror\.test trả về HTTP 504/,
    );
  });
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
