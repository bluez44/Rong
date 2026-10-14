import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GooglePlacesService,
  GoogleUnavailableError,
} from './google-places.service.js';

const BASE = 'https://places.test/v1';
const service = (key: string | null = 'KEY') =>
  new GooglePlacesService({
    mapsApiKey: key,
    placesUrl: BASE,
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
          displayName: { text: 'Chợ Đà Lạt' },
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
      name: 'Chợ Đà Lạt',
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
    expect(header(detailsCall, 'X-Goog-FieldMask')).toContain('displayName');
    expect(header(detailsCall, 'X-Goog-FieldMask')).not.toContain('location');
    expect(header(detailsCall, 'X-Goog-FieldMask')).not.toContain(
      'primaryType',
    );
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

describe('GooglePlacesService.searchText', () => {
  it('chỉ xin id + location, ưu tiên khung vùng, tối đa 3', async () => {
    const calls = mockFetch(() => ({
      body: {
        places: [
          { id: 'A', location: { latitude: 11.94, longitude: 108.44 } },
          { id: 'B', location: { latitude: 11.95, longitude: 108.45 } },
        ],
      },
    }));
    await expect(
      service().searchText(
        'Bánh căn Nhà Chung, Đà Lạt',
        [11.8, 108.3, 12.0, 108.6],
      ),
    ).resolves.toEqual([
      { placeId: 'A', lat: 11.94, lng: 108.44 },
      { placeId: 'B', lat: 11.95, lng: 108.45 },
    ]);
    const [call] = calls;
    expect(call.url).toBe(`${BASE}/places:searchText`);
    expect(header(call, 'X-Goog-FieldMask')).toBe('places.id,places.location');
    const body = JSON.parse(call.init.body as string);
    expect(body).toMatchObject({
      textQuery: 'Bánh căn Nhà Chung, Đà Lạt',
      regionCode: 'VN',
      pageSize: 3,
    });
    expect(body.locationBias.rectangle).toEqual({
      low: { latitude: 11.8, longitude: 108.3 },
      high: { latitude: 12.0, longitude: 108.6 },
    });
  });

  it('không có khung thì không gửi locationBias; bỏ kết quả thiếu tọa độ', async () => {
    const calls = mockFetch(() => ({ body: { places: [{ id: 'A' }] } }));
    await expect(service().searchText('x', null)).resolves.toEqual([]);
    expect(
      JSON.parse(calls[0].init.body as string).locationBias,
    ).toBeUndefined();
  });
});

describe('GooglePlacesService.locate / summary', () => {
  it('locate chỉ xin location', async () => {
    const calls = mockFetch(() => ({
      body: { location: { latitude: 1, longitude: 2 } },
    }));
    await expect(service().locate('ChIJ1')).resolves.toEqual({
      lat: 1,
      lng: 2,
    });
    expect(calls[0].url).toBe(`${BASE}/places/ChIJ1`);
    expect(header(calls[0], 'X-Goog-FieldMask')).toBe('location');
  });

  it('summary xin displayName + formattedAddress; 404 → null', async () => {
    const calls = mockFetch((url) =>
      url.includes('/gone')
        ? { status: 404, body: {} }
        : {
            body: {
              displayName: { text: 'Bánh căn Nhà Chung' },
              formattedAddress: '1 Nhà Chung',
            },
          },
    );
    await expect(service().summary('ChIJ1')).resolves.toEqual({
      name: 'Bánh căn Nhà Chung',
      address: '1 Nhà Chung',
    });
    expect(calls[0].url).toContain(`${BASE}/places/ChIJ1`);
    expect(header(calls[0], 'X-Goog-FieldMask')).toBe(
      'displayName,formattedAddress',
    );
    await expect(service().summary('gone')).resolves.toBeNull();
  });
});

describe('GooglePlacesService.searchByName', () => {
  it('xin id + tên + địa chỉ, giới hạn trong khung vùng, giữ thứ tự Google', async () => {
    const calls = mockFetch(() => ({
      body: {
        places: [
          {
            id: 'B',
            displayName: { text: 'Quán B' },
            formattedAddress: '2 Đường B',
            primaryType: 'cafe',
          },
          { id: 'A', displayName: { text: 'Quán A' } },
        ],
      },
    }));
    await expect(
      service().searchByName('quán', [11.8, 108.3, 12.0, 108.6]),
    ).resolves.toEqual([
      {
        googlePlaceId: 'B',
        name: 'Quán B',
        address: '2 Đường B',
        suggestedCategory: 'cafe',
      },
      {
        googlePlaceId: 'A',
        name: 'Quán A',
        address: null,
        suggestedCategory: 'check_in',
      },
    ]);
    const [call] = calls;
    expect(call.url).toBe(`${BASE}/places:searchText`);
    expect(header(call, 'X-Goog-FieldMask')).toBe(
      'places.id,places.displayName,places.formattedAddress,places.primaryType',
    );
    const body = JSON.parse(call.init.body as string);
    expect(body).toMatchObject({
      textQuery: 'quán',
      regionCode: 'VN',
      languageCode: 'vi',
      pageSize: 5,
    });
    expect(body.locationRestriction.rectangle).toEqual({
      low: { latitude: 11.8, longitude: 108.3 },
      high: { latitude: 12.0, longitude: 108.6 },
    });
  });
});

describe('GooglePlacesService.preview', () => {
  it('như details, thêm location và primaryType', async () => {
    const calls = mockFetch((url) =>
      url.includes('/media')
        ? { body: {} }
        : {
            body: {
              id: 'P1',
              displayName: { text: 'Quán P' },
              location: { latitude: 11.9, longitude: 108.4 },
              primaryType: 'cafe',
            },
          },
    );
    const result = await service().preview('P1');
    expect(result?.content).toMatchObject({ placeId: 'P1', name: 'Quán P' });
    expect(result?.location).toEqual({ lat: 11.9, lng: 108.4 });
    expect(result?.primaryType).toBe('cafe');
    expect(header(calls[0], 'X-Goog-FieldMask')).toContain('location');
    expect(header(calls[0], 'X-Goog-FieldMask')).toContain('primaryType');
  });

  it('404 → null', async () => {
    mockFetch(() => ({ status: 404, body: {} }));
    await expect(service().preview('gone')).resolves.toBeNull();
  });
});

describe('GooglePlacesService.findPlace', () => {
  it('Text Search giới hạn trong khung vùng, chỉ xin id/vị trí/tên/loại', async () => {
    const calls = mockFetch(() => ({
      body: {
        places: [
          {
            id: 'ChIJ1',
            location: { latitude: 11.9, longitude: 108.4 },
            displayName: { text: 'Thác Datanla' },
            primaryType: 'tourist_attraction',
          },
          { id: 'ChIJ2' },
        ],
      },
    }));

    await expect(
      service().findPlace('Thác Datanla, Đà Lạt', [11.8, 108.3, 12.0, 108.6]),
    ).resolves.toEqual([
      {
        placeId: 'ChIJ1',
        lat: 11.9,
        lng: 108.4,
        name: 'Thác Datanla',
        primaryType: 'tourist_attraction',
      },
    ]);

    const [call] = calls;
    expect(call.url).toBe(`${BASE}/places:searchText`);
    expect(header(call, 'X-Goog-FieldMask')).toBe(
      'places.id,places.location,places.displayName,places.primaryType',
    );
    const body = JSON.parse(call.init.body as string);
    expect(body).toMatchObject({
      textQuery: 'Thác Datanla, Đà Lạt',
      pageSize: 3,
      locationRestriction: {
        rectangle: {
          low: { latitude: 11.8, longitude: 108.3 },
          high: { latitude: 12.0, longitude: 108.6 },
        },
      },
    });
  });

  it('Google lỗi thì ném GoogleUnavailableError', async () => {
    mockFetch(() => ({ status: 500, body: {} }));
    await expect(service().findPlace('x', [1, 2, 3, 4])).rejects.toBeInstanceOf(
      GoogleUnavailableError,
    );
  });
});
