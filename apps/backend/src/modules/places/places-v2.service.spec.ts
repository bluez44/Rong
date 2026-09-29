import {
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlaceSearchAgent } from '../../langchain/place-search-agent.js';
import type { WebSource } from '../../langchain/web-search.tool.js';
import {
  GoogleUnavailableError,
  type GooglePlacesService,
} from '../google/google-places.service.js';
import type { RegionAreaService } from '../regions/region-area.service.js';
import { PlacesV2Service } from './places-v2.service.js';

const REGION_ID = '7f1c1e0a-0000-4000-8000-000000000001';
const BBOX = [11.8, 108.3, 12.0, 108.6];

const place = (patch: object = {}) => ({
  title: 'Hồ Xuân Hương',
  description: 'Hồ ở trung tâm Đà Lạt',
  address: '',
  // Tọa độ Gemini đoán: chỉ dùng khi không định vị được.
  location: { lat: 11.93, lng: 108.45 },
  category: 'nature' as const,
  tags: ['hồ'],
  openHours: { open: '00:00', close: '24:00' },
  ...patch,
});

const article = (uri: string, content: string, patch: object = {}): WebSource => ({
  title: 'Bài viết',
  uri,
  content,
  publishedAt: null,
  ...patch,
});

const catalogRow = (idx: number, patch: object = {}) => ({
  idx: String(idx),
  id: 'c0000000-0000-4000-8000-000000000001',
  lat: 11.9425,
  lng: 108.4459,
  osm_type: 'way',
  osm_id: '123',
  wikidata_id: 'Q1',
  opening_hours: null,
  website: null,
  ...patch,
});

function build(options: {
  region?: object | null;
  places?: ReturnType<typeof place>[];
  sources?: WebSource[];
  findPlaces?: PlaceSearchAgent['findPlaces'];
  catalog?: object[];
  locate?: GooglePlacesService['geocode'];
  googleEnabled?: boolean;
  agentEnabled?: boolean;
  ensure?: RegionAreaService['ensure'];
}) {
  const region =
    options.region === undefined
      ? { name: 'Đà Lạt', parent_name: 'Lâm Đồng', bbox: BBOX }
      : options.region;
  const query = vi.fn((sql: string) =>
    Promise.resolve(
      sql.includes('FROM regions')
        ? region
          ? [region]
          : []
        : (options.catalog ?? []),
    ),
  );
  const places = options.places ?? [place()];
  const findPlaces = vi.fn(
    options.findPlaces ??
      (() =>
        Promise.resolve({
          places,
          // Mặc định có một bài nhắc tới mọi địa điểm.
          sources: options.sources ?? [
            article(
              'https://blog.vn',
              `Gợi ý: ${places.map((p) => p.title).join(', ')}.`,
              { title: 'Blog' },
            ),
          ],
        })),
  );
  const locate = vi.fn(
    options.locate ??
      (() => Promise.resolve({ placeId: 'gp1', lat: 11.95, lng: 108.44 })),
  );
  const ensure = vi.fn(options.ensure ?? (() => Promise.resolve(BBOX)));

  const service = new PlacesV2Service(
    { query } as unknown as DataSource,
    {
      enabled: options.agentEnabled ?? true,
      findPlaces,
    } as unknown as PlaceSearchAgent,
    { ensure } as unknown as RegionAreaService,
    {
      enabled: options.googleEnabled ?? true,
      geocode: locate,
    } as unknown as GooglePlacesService,
  );
  return { service, findPlaces, locate, ensure, query };
}

/** Trang bài viết: có meta ngày đăng. */
let pageFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  pageFetch = vi.fn(async () =>
    new Response(
      '<meta property="article:published_time" content="2024-03-12T00:00:00Z">',
      { headers: { 'content-type': 'text/html' } },
    ),
  );
  vi.stubGlobal('fetch', pageFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('PlacesV2Service — định vị', () => {
  it('khớp danh mục: dùng id và tọa độ OSM, không gọi Google', async () => {
    const { service, locate } = build({ catalog: [catalogRow(1)] });
    const page = await service.listForRegion(REGION_ID, {});

    expect(locate).not.toHaveBeenCalled();
    expect(page).toMatchObject({ source: 'ai_web_search', nextCursor: null });
    expect(page.attribution).not.toContain('Google');
    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'c0000000-0000-4000-8000-000000000001',
        name: 'Hồ Xuân Hương',
        coordinates: { lat: 11.9425, lng: 108.4459 },
        locationSource: 'catalog',
        wikidataId: 'Q1',
        openingHours: '00:00-24:00',
        sourceUrl: 'https://www.openstreetmap.org/way/123',
      }),
    ]);
  });

  it('không có trong danh mục: Geocoding theo tên + địa chỉ trong khung bao', async () => {
    const { service, locate } = build({
      places: [place({ title: 'Quán A', category: 'food', address: '2 Lê Lợi' })],
    });
    const page = await service.listForRegion(REGION_ID, {});

    expect(locate).toHaveBeenCalledWith('Quán A, 2 Lê Lợi, Đà Lạt, Lâm Đồng', BBOX);
    expect(page.attribution).toContain('Google Maps');
    expect(page.items).toEqual([
      expect.objectContaining({
        id: null,
        coordinates: { lat: 11.95, lng: 108.44 },
        locationSource: 'geocoding',
        sourceUrl: expect.stringContaining('query_place_id=gp1'),
      }),
    ]);
  });

  it('Geocoding lỗi (chưa bật billing…) vẫn trả đủ danh sách, dùng tọa độ AI', async () => {
    const { service } = build({
      places: [place(), place({ title: 'Quán A', category: 'food' })],
      locate: () =>
        Promise.reject(new GoogleUnavailableError('Geocoding trả về REQUEST_DENIED')),
    });
    const page = await service.listForRegion(REGION_ID, {});

    expect(page.items.map((i) => [i.name, i.locationSource, i.coordinates])).toEqual([
      ['Hồ Xuân Hương', 'ai', { lat: 11.93, lng: 108.45 }],
      ['Quán A', 'ai', { lat: 11.93, lng: 108.45 }],
    ]);
  });

  it('Geocoding không tìm ra hoặc chưa cấu hình Google: dùng tọa độ AI', async () => {
    const notFound = build({ locate: () => Promise.resolve(null) });
    expect((await notFound.service.listForRegion(REGION_ID, {})).items[0]).toMatchObject({
      locationSource: 'ai',
    });

    const disabled = build({ googleEnabled: false });
    const page = await disabled.service.listForRegion(REGION_ID, {});
    expect(disabled.locate).not.toHaveBeenCalled();
    expect(page.items[0]).toMatchObject({ locationSource: 'ai' });
  });

  it('tọa độ AI nằm ngoài vùng thì bỏ', async () => {
    const { service } = build({
      places: [place({ location: { lat: 21.03, lng: 105.85 } })],
      locate: () => Promise.resolve(null),
    });
    expect((await service.listForRegion(REGION_ID, {})).items).toEqual([]);
  });

  it('lọc loại trước khi tra tọa độ', async () => {
    const { service, locate } = build({
      places: [
        place({ title: 'Quán A', category: 'food' }),
        place({ title: 'Khách sạn B', category: 'stay' }),
      ],
    });
    const page = await service.listForRegion(REGION_ID, {});
    expect(locate).toHaveBeenCalledTimes(1);
    expect(page.items.map((i) => i.name)).toEqual(['Quán A']);
  });

  it('hai tên cùng trỏ về một địa điểm thì giữ một', async () => {
    const { service } = build({
      places: [place(), place({ title: 'Hồ Xuân Hương Đà Lạt' })],
      catalog: [catalogRow(1), catalogRow(2)],
    });
    expect((await service.listForRegion(REGION_ID, {})).items).toHaveLength(1);
  });

  it('vùng chưa có khung bao: tính song song; lỗi thì Geocoding không giới hạn', async () => {
    const noBbox = { name: 'Đà Lạt', parent_name: null, bbox: null };

    const ok = build({ region: noBbox });
    await ok.service.listForRegion(REGION_ID, {});
    expect(ok.ensure).toHaveBeenCalledWith(REGION_ID);
    expect(ok.locate).toHaveBeenCalledWith(expect.any(String), BBOX);

    const failed = build({
      region: noBbox,
      ensure: () => Promise.reject(new Error('Nominatim down')),
    });
    const page = await failed.service.listForRegion(REGION_ID, {});
    expect(failed.locate).toHaveBeenCalledWith('Hồ Xuân Hương, Đà Lạt', null);
    expect(failed.query).toHaveBeenCalledTimes(1);
    expect(page.items).toHaveLength(1);
  });
});

describe('PlacesV2Service — đối chiếu nguồn', () => {
  it('bỏ địa điểm không có trong bài viết nào', async () => {
    const { service, locate } = build({
      places: [place(), place({ title: 'Dinh Bảo Đại', category: 'culture' })],
      sources: [article('https://a.vn', 'Sáng đi dạo quanh hồ Xuân Hương.')],
    });
    const page = await service.listForRegion(REGION_ID, {});

    expect(page.items.map((i) => i.name)).toEqual(['Hồ Xuân Hương']);
    // Địa điểm bị loại không tốn lượt Geocoding.
    expect(locate).toHaveBeenCalledTimes(1);
  });

  it('mỗi địa điểm kèm các bài nhắc tới nó và ngày đăng bài', async () => {
    const { service } = build({
      googleEnabled: false,
      places: [place(), place({ title: 'Chợ Đà Lạt', category: 'food' })],
      sources: [
        article('https://a.vn', 'Hồ Xuân Hương và Chợ Đà Lạt', { title: 'A' }),
        article('https://b.vn', 'Ăn tối ở chợ Đà Lạt', {
          title: 'B',
          publishedAt: '2023-01-05',
        }),
        article('https://c.vn', 'Bài không nhắc địa điểm nào', { title: 'C' }),
      ],
    });
    const page = await service.listForRegion(REGION_ID, {});

    expect(page.items.find((i) => i.name === 'Hồ Xuân Hương')?.articles).toEqual([
      { title: 'A', uri: 'https://a.vn', publishedAt: '2024-03-12T00:00:00.000Z' },
    ]);
    expect(page.items.find((i) => i.name === 'Chợ Đà Lạt')?.articles).toEqual([
      { title: 'A', uri: 'https://a.vn', publishedAt: '2024-03-12T00:00:00.000Z' },
      // Tavily đã có ngày thì dùng luôn, không tải trang.
      { title: 'B', uri: 'https://b.vn', publishedAt: '2023-01-05' },
    ]);
    // Chỉ các bài được dẫn mới vào groundingSources và mới bị tải để đọc ngày.
    expect(page.groundingSources?.map((s) => s.uri)).toEqual(['https://a.vn', 'https://b.vn']);
    expect(pageFetch.mock.calls.map(([url]) => url)).toEqual(['https://a.vn']);
  });

  it('không đọc được ngày thì publishedAt null', async () => {
    pageFetch.mockRejectedValue(new Error('timeout'));
    const { service } = build({});
    const page = await service.listForRegion(REGION_ID, {});
    expect(page.items[0].articles?.[0].publishedAt).toBeNull();
  });
});

describe('PlacesV2Service — cache và lỗi', () => {
  it('cache kết quả agent (kể cả ngày đăng), nhưng Geocoding tra lại mỗi lần', async () => {
    const { service, findPlaces, locate } = build({});
    await Promise.all([
      service.listForRegion(REGION_ID, {}),
      service.listForRegion(REGION_ID, {}),
    ]);
    await service.listForRegion(REGION_ID, {});
    expect(findPlaces).toHaveBeenCalledTimes(1);
    expect(pageFetch).toHaveBeenCalledTimes(1);
    expect(locate).toHaveBeenCalledTimes(3);
  });

  it('agent lỗi thì 503 và không cache lỗi', async () => {
    const findPlaces = vi
      .fn()
      .mockRejectedValueOnce(new Error('Tavily down'))
      .mockResolvedValue({
        places: [place()],
        sources: [article('https://a.vn', 'Hồ Xuân Hương')],
      });
    const { service } = build({ findPlaces });

    await expect(service.listForRegion(REGION_ID, {})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect((await service.listForRegion(REGION_ID, {})).items).toHaveLength(1);
  });

  it('chưa cấu hình TAVILY_API_KEY thì 503', async () => {
    const { service, findPlaces } = build({ agentEnabled: false });
    await expect(service.listForRegion(REGION_ID, {})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(findPlaces).not.toHaveBeenCalled();
  });

  it('vùng không tồn tại thì 404', async () => {
    const { service } = build({ region: null });
    await expect(service.listForRegion(REGION_ID, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
