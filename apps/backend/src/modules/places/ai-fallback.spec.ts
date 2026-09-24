import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { OpenDataConfig } from '../../config/configuration.js';
import type { LangchainService } from '../../langchain/langchain.service.js';
import type { GooglePlacesService } from '../google/google-places.service.js';
import { OpenDataError } from '../open-data/http.js';
import type { OpenDataService } from '../open-data/open-data.service.js';
import type { RegionAreaService } from '../regions/region-area.service.js';
import { aiPlaceToListItem } from './ai-fallback.js';
import { PlacesService } from './places.service.js';

const aiPlace = (patch: object = {}) => ({
  title: 'Hồ Xuân Hương',
  description: 'Hồ ở trung tâm Đà Lạt',
  location: { lat: 11.94, lng: 108.44 },
  category: 'nature' as const,
  tags: ['hồ'],
  openHours: { open: '00:00', close: '24:00' },
  ...patch,
});

describe('aiPlaceToListItem', () => {
  it('không có id, không có điểm, link Google Maps theo tên', () => {
    expect(aiPlaceToListItem(aiPlace(), 'Đà Lạt, Lâm Đồng')).toMatchObject({
      id: null,
      name: 'Hồ Xuân Hương',
      category: 'nature',
      compositeScore: 0,
      openingHours: '00:00-24:00',
      hours: { openNow: true, today: 'Mở cả ngày' },
      sourceUrl:
        'https://www.google.com/maps/search/?api=1&query=H%E1%BB%93%20Xu%C3%A2n%20H%C6%B0%C6%A1ng%2C%20%C4%90%C3%A0%20L%E1%BA%A1t%2C%20L%C3%A2m%20%C4%90%E1%BB%93ng',
    });
  });

  it('bỏ mục có tọa độ ngoài Việt Nam hoặc không có tên; giờ sai định dạng thì để không rõ', () => {
    expect(
      aiPlaceToListItem(aiPlace({ location: { lat: 48.85, lng: 2.35 } }), 'x'),
    ).toBeNull();
    expect(aiPlaceToListItem(aiPlace({ title: ' ' }), 'x')).toBeNull();
    expect(
      aiPlaceToListItem(
        aiPlace({ openHours: { open: '7h sáng', close: 'tối' } }),
        'x',
      ),
    ).toMatchObject({ openingHours: null, hours: null });
    expect(
      aiPlaceToListItem(aiPlace({ category: 'shopping' }), 'x')?.category,
    ).toBe('check_in');
  });
});

describe('PlacesService.listForRegion — dự phòng khi nguồn dữ liệu mở lỗi', () => {
  function build(options: {
    areaError?: Error;
    overpassError?: Error;
    cachedPlaces: boolean;
  }) {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT EXISTS'))
          return [{ found: options.cachedPlaces }];
        if (sql.includes('FROM regions r LEFT JOIN regions p')) {
          return [{ name: 'Đà Lạt', parent_name: 'Lâm Đồng' }];
        }
        if (sql.includes('SELECT name, places_fetched_at')) {
          return [{ name: 'Đà Lạt', places_fetched_at: null }];
        }
        if (sql.includes('FROM places p')) {
          return [
            {
              id: '3f1c2b4e-8a9d-4c7e-9f0a-1b2c3d4e5f60',
              name: 'Hồ Xuân Hương (đã lưu)',
              category: 'nature',
              lat: 11.94,
              lng: 108.44,
              composite_score: 78,
              description: null,
              opening_hours: null,
              website: null,
              wikidata_id: null,
              osm_type: 'way',
              osm_id: '1',
            },
          ];
        }
        return [];
      }),
    };
    const areas = {
      ensure: vi.fn(async () => {
        if (options.areaError) throw options.areaError;
        return [11.87, 108.38, 12.01, 108.53];
      }),
    };
    const openData = {
      placesInBbox: vi.fn(async () => {
        if (options.overpassError) throw options.overpassError;
        return [];
      }),
      wikidata: vi.fn(async () => new Map()),
    };
    const langchain = {
      findPlaces: vi.fn(async () => ({
        places: [aiPlace(), aiPlace({ title: 'Khách sạn', category: 'stay' })],
        sources: [
          { title: 'Hồ Xuân Hương', uri: 'https://maps.google.com/?cid=1' },
        ],
      })),
    };
    const service = new PlacesService(
      db as never,
      openData as unknown as OpenDataService,
      areas as unknown as RegionAreaService,
      { placesRefreshDays: 30 } as OpenDataConfig,
      {} as GooglePlacesService,
      langchain as unknown as LangchainService,
    );
    return { service, langchain };
  }

  const id = '11111111-1111-1111-1111-111111111111';

  it('Overpass lỗi, chưa có dữ liệu → kết quả Gemini, không có mục lưu trú mặc định', async () => {
    const { service, langchain } = build({
      overpassError: new OpenDataError('overpass-api.de trả về HTTP 504', 504),
      cachedPlaces: false,
    });

    const page = await service.listForRegion(id, {});

    expect(langchain.findPlaces).toHaveBeenCalledWith('Đà Lạt, Lâm Đồng');
    expect(page.source).toBe('ai_google_maps');
    expect(page.items.map((i) => i.name)).toEqual(['Hồ Xuân Hương']);
    expect(page.groundingSources).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('không xác định được khu vực (503) → cũng dùng Gemini', async () => {
    const { service } = build({
      areaError: new ServiceUnavailableException({ code: 'AREA_UNAVAILABLE' }),
      cachedPlaces: false,
    });
    await expect(service.listForRegion(id, {})).resolves.toMatchObject({
      source: 'ai_google_maps',
    });
  });

  it('Overpass lỗi nhưng đã có dữ liệu lưu → trả dữ liệu lưu, không gọi Gemini', async () => {
    const { service, langchain } = build({
      overpassError: new OpenDataError('504', 504),
      cachedPlaces: true,
    });

    const page = await service.listForRegion(id, {});

    expect(page.source).toBe('catalog');
    expect(page.items[0].name).toBe('Hồ Xuân Hương (đã lưu)');
    expect(langchain.findPlaces).not.toHaveBeenCalled();
  });

  it('lỗi khác (lỗi code, database) không bị che bằng dự phòng', async () => {
    const { service, langchain } = build({
      areaError: new TypeError('bug'),
      cachedPlaces: false,
    });
    await expect(service.listForRegion(id, {})).rejects.toThrow('bug');
    expect(langchain.findPlaces).not.toHaveBeenCalled();
  });

  it('Gemini cũng lỗi → 503 PLACES_UNAVAILABLE', async () => {
    const { service, langchain } = build({
      overpassError: new OpenDataError('504', 504),
      cachedPlaces: false,
    });
    langchain.findPlaces.mockRejectedValueOnce(new Error('quota'));

    await expect(service.listForRegion(id, {})).rejects.toMatchObject({
      response: { code: 'PLACES_UNAVAILABLE' },
    });
  });
});
