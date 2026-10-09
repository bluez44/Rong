import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GooglePlacesService,
  GoogleUnavailableError,
} from './google-places.service.js';

const BASE = 'https://places.test/v1';
const GEOCODE = 'https://geocode.test/json';
const service = (key: string | null = 'KEY') =>
  new GooglePlacesService({
    mapsApiKey: key,
    placesUrl: BASE,
    geocodingUrl: GEOCODE,
  });

type Call = { url: string; init: RequestInit };
function mockFetch(
  handler: (url: string) => { status?: number; body: unknown },
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const { status = 200, body } = handler(url);
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}
const header = (call: Call, name: string) =>
  (call.init.headers as Record<string, string>)[name];

afterEach(() => vi.unstubAllGlobals());

describe('GooglePlacesService.matchPlaceId', () => {
  it('chỉ xin trường id (SKU IDs Only miễn phí) và khóa nằm ở header, không ở URL', async () => {
    const calls = mockFetch(() => ({ body: { places: [{ id: 'ChIJabc' }] } }));

    await expect(
      service().matchPlaceId('Hồ Xuân Hương', 11.94, 108.44),
    ).resolves.toBe('ChIJabc');

    const [call] = calls;
    expect(call.url).toBe(`${BASE}/places:searchText`);
    expect(call.url).not.toContain('KEY');
    expect(header(call, 'X-Goog-Api-Key')).toBe('KEY');
    expect(header(call, 'X-Goog-FieldMask')).toBe('places.id');
    const body = JSON.parse(call.init.body as string);
    expect(body).toMatchObject({
      textQuery: 'Hồ Xuân Hương',
      languageCode: 'vi',
      regionCode: 'VN',
    });
    expect(body.locationRestriction.rectangle.low.latitude).toBeCloseTo(
      11.9375,
    );
    expect(body.locationRestriction.rectangle.high.longitude).toBeCloseTo(
      108.4425,
    );
  });

  it('không có kết quả thì null', async () => {
    mockFetch(() => ({ body: {} }));
    await expect(service().matchPlaceId('x', 0, 0)).resolves.toBeNull();
  });

  it('chưa cấu hình khóa thì báo unavailable, không gọi mạng', async () => {
    const calls = mockFetch(() => ({ body: {} }));
    await expect(service(null).matchPlaceId('x', 0, 0)).rejects.toBeInstanceOf(
      GoogleUnavailableError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('GooglePlacesService.details', () => {
  it('ánh xạ rating, đánh giá, giờ mở cửa, ảnh kèm tác giả', async () => {
    const calls = mockFetch((url) => {
      if (url.includes('/media')) {
        return {
          body: {
            photoUri: `https://lh3.googleusercontent.com/${url.includes('p1') ? 'a' : 'b'}`,
          },
        };
      }
      return {
        body: {
          id: 'ChIJabc',
          formattedAddress: 'Đà Lạt, Lâm Đồng',
          googleMapsUri: 'https://maps.google.com/?cid=1',
          rating: 4.6,
          userRatingCount: 12345,
          currentOpeningHours: {
            openNow: true,
            weekdayDescriptions: ['Thứ Hai: Mở cửa 24 giờ'],
          },
          regularOpeningHours: {
            weekdayDescriptions: [
              'Thứ Hai: Mở cửa 24 giờ',
              'Thứ Ba: Mở cửa 24 giờ',
            ],
          },
          reviews: [
            {
              rating: 5,
              text: { text: 'Đẹp' },
              relativePublishTimeDescription: '2 tuần trước',
              publishTime: '2026-09-01T00:00:00Z',
              googleMapsUri: 'https://maps.google.com/review/1',
              authorAttribution: {
                displayName: 'Linh',
                uri: 'https://maps.google.com/u/1',
                photoUri: 'https://p/1',
              },
            },
          ],
          photos: [
            {
              name: 'places/ChIJabc/photos/p1',
              widthPx: 4000,
              heightPx: 3000,
              authorAttributions: [{ displayName: 'Hà' }],
            },
            { name: 'places/ChIJabc/photos/p2', widthPx: 800, heightPx: 600 },
            { name: 'places/ChIJabc/photos/p3', widthPx: 800, heightPx: 600 },
            { name: 'places/ChIJabc/photos/p4', widthPx: 800, heightPx: 600 },
          ],
        },
      };
    });

    const content = await service().details('ChIJabc');

    expect(content).toMatchObject({
      placeId: 'ChIJabc',
      rating: 4.6,
      ratingCount: 12345,
      openNow: true,
      weekdayHours: ['Thứ Hai: Mở cửa 24 giờ', 'Thứ Ba: Mở cửa 24 giờ'],
      reviews: [
        {
          author: {
            name: 'Linh',
            uri: 'https://maps.google.com/u/1',
            photoUri: 'https://p/1',
          },
          rating: 5,
          text: 'Đẹp',
          relativeTime: '2 tuần trước',
        },
      ],
    });
    expect(content!.photos).toHaveLength(3); // tối đa 3 ảnh, mỗi ảnh một lần gọi tính phí
    expect(content!.photos[0]).toEqual({
      url: 'https://lh3.googleusercontent.com/a',
      width: 4000,
      height: 3000,
      authors: [{ name: 'Hà', uri: null, photoUri: null }],
    });

    const detailsCall = calls.find((c) => !c.url.includes('/media'))!;
    expect(detailsCall.url).toBe(
      `${BASE}/places/ChIJabc?languageCode=vi&regionCode=VN`,
    );
    expect(header(detailsCall, 'X-Goog-FieldMask')).toContain('rating');
    expect(calls.filter((c) => c.url.includes('/media'))).toHaveLength(3);
    expect(
      calls.every(
        (c) =>
          c.url.includes('skipHttpRedirect=true') || !c.url.includes('/media'),
      ),
    ).toBe(true);
  });

  it('một ảnh lỗi không làm hỏng cả trang chi tiết', async () => {
    mockFetch((url) =>
      url.includes('/media')
        ? { status: 500, body: {} }
        : {
            body: {
              id: 'X',
              photos: [{ name: 'places/X/photos/p1', widthPx: 1, heightPx: 1 }],
            },
          },
    );
    await expect(service().details('X')).resolves.toMatchObject({
      photos: [],
      reviews: [],
      rating: null,
    });
  });

  it('404 → null (place_id hết hiệu lực); lỗi khác → unavailable', async () => {
    mockFetch(() => ({ status: 404, body: { error: {} } }));
    await expect(service().details('gone')).resolves.toBeNull();

    mockFetch(() => ({ status: 429, body: { error: {} } }));
    await expect(service().details('busy')).rejects.toBeInstanceOf(
      GoogleUnavailableError,
    );
  });
});

describe('GooglePlacesService.geocode', () => {
  const BBOX: [number, number, number, number] = [11.8, 108.3, 12.0, 108.6];
  const result = (types: string[], lat = 11.94, lng = 108.44) => ({
    place_id: `id-${types[0]}`,
    types,
    geometry: { location: { lat, lng } },
  });

  it('gọi Geocoding API với khóa Maps, ưu tiên khung bao của vùng', async () => {
    const calls = mockFetch(() => ({
      body: {
        status: 'OK',
        results: [result(['tourist_attraction', 'point_of_interest'])],
      },
    }));

    await expect(
      service().geocode('Hồ Xuân Hương, Đà Lạt', BBOX),
    ).resolves.toEqual({
      placeId: 'id-tourist_attraction',
      lat: 11.94,
      lng: 108.44,
    });

    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(GEOCODE);
    expect(url.searchParams.get('address')).toBe('Hồ Xuân Hương, Đà Lạt');
    expect(url.searchParams.get('key')).toBe('KEY');
    expect(url.searchParams.get('bounds')).toBe('11.8,108.3|12,108.6');
    expect(url.searchParams.get('components')).toBe('country:VN');
  });

  it('bỏ kết quả chỉ là đơn vị hành chính, tên đường, hoặc ngoài vùng', async () => {
    mockFetch(() => ({
      body: {
        status: 'OK',
        results: [
          result(['locality', 'political']),
          result(['route']),
          result(['point_of_interest'], 21.03, 105.85),
          result(['premise']),
        ],
      },
    }));
    await expect(service().geocode('Quán A', BBOX)).resolves.toMatchObject({
      placeId: 'id-premise',
    });

    mockFetch(() => ({
      body: { status: 'OK', results: [result(['locality', 'political'])] },
    }));
    await expect(service().geocode('Nơi bịa', BBOX)).resolves.toBeNull();
  });

  it('không có khung bao thì không gửi bounds và không lọc vị trí', async () => {
    const calls = mockFetch(() => ({
      body: {
        status: 'OK',
        results: [result(['point_of_interest'], 21.03, 105.85)],
      },
    }));
    await expect(service().geocode('Hồ Gươm', null)).resolves.toMatchObject({
      lat: 21.03,
    });
    expect(new URL(calls[0].url).searchParams.has('bounds')).toBe(false);
  });

  it('ZERO_RESULTS → null; lỗi quota, khóa, mạng → unavailable', async () => {
    mockFetch(() => ({ body: { status: 'ZERO_RESULTS', results: [] } }));
    await expect(service().geocode('x', BBOX)).resolves.toBeNull();

    mockFetch(() => ({
      body: { status: 'REQUEST_DENIED', error_message: 'API not enabled' },
    }));
    await expect(service().geocode('x', BBOX)).rejects.toBeInstanceOf(
      GoogleUnavailableError,
    );

    mockFetch(() => ({ status: 500, body: {} }));
    await expect(service().geocode('x', BBOX)).rejects.toBeInstanceOf(
      GoogleUnavailableError,
    );

    await expect(service(null).geocode('x', BBOX)).rejects.toBeInstanceOf(
      GoogleUnavailableError,
    );
  });

  it('cache tọa độ theo truy vấn + khung bao, hết 30 ngày thì gọi lại', async () => {
    vi.useFakeTimers();
    try {
      const calls = mockFetch(() => ({
        body: { status: 'OK', results: [result(['point_of_interest'])] },
      }));
      const google = service();

      await google.geocode('Hồ Xuân Hương', BBOX);
      await expect(
        google.geocode('Hồ Xuân Hương', BBOX),
      ).resolves.toMatchObject({
        lat: 11.94,
      });
      expect(calls).toHaveLength(1);

      await google.geocode('Hồ Xuân Hương', null);
      expect(calls).toHaveLength(2);

      vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000 + 1);
      await google.geocode('Hồ Xuân Hương', BBOX);
      expect(calls).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('không tìm ra thì nhớ một ngày; lỗi thì không cache', async () => {
    vi.useFakeTimers();
    try {
      const google = service();
      mockFetch(() => ({ status: 500, body: {} }));
      await expect(google.geocode('x', BBOX)).rejects.toBeInstanceOf(
        GoogleUnavailableError,
      );

      const calls = mockFetch(() => ({
        body: { status: 'ZERO_RESULTS', results: [] },
      }));
      await expect(google.geocode('x', BBOX)).resolves.toBeNull();
      await expect(google.geocode('x', BBOX)).resolves.toBeNull();
      expect(calls).toHaveLength(1);

      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
      await google.geocode('x', BBOX);
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
