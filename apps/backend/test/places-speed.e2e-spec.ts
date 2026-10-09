import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';
import { PlaceSearchService } from '../src/langchain/place-search.service.js';
import { GOOGLE_CONFIG } from '../src/modules/google/google-places.service.js';
import { OpenDataError } from '../src/modules/open-data/http.js';
import { OpenDataService } from '../src/modules/open-data/open-data.service.js';
import type { OverpassElement } from '../src/modules/open-data/open-data.types.js';
import { PlacesService } from '../src/modules/places/places.service.js';

/**
 * Kiểm tra tốc độ của hai API danh sách địa điểm trên database thật. Dịch vụ
 * ngoài (Overpass, Nominatim, Tavily + Gemini, Geocoding, trang bài viết) là
 * bản giả với độ trễ cố định, nên thời gian đo được chỉ còn phụ thuộc vào cách
 * code chờ chúng: phần nào phải song song, phần nào phải chạy ở nền.
 *
 * Ngưỡng DB_BUDGET_MS đủ rộng cho database ở xa (Neon); mỗi kiểm tra so với
 * độ trễ giả lớn hơn hẳn, nên nếu code lỡ chờ thứ không nên chờ thì vượt rõ.
 */
const DB_BUDGET_MS = 1500;
/** Mỗi lần gọi Overpass giả. v1 gọi hai lần nối tiếp (điểm tham quan, dịch vụ). */
const OVERPASS_MS = 3000;
/** Nominatim giả, cho vùng chưa có khung bao: lâu hơn hẳn mọi ngưỡng. */
const NOMINATIM_MS = 15_000;
/** Tavily + Gemini giả. */
const SEARCH_MS = 1000;
/** Mỗi lượt Geocoding giả. */
const GEOCODE_MS = 500;
/** Chờ ngày đăng bài tối đa (DATES_WAIT_MS trong places-v2.service.ts). */
const DATES_WAIT_MS = 1500;
/** Chờ khung bao tối đa (BBOX_WAIT_MS trong places-v2.service.ts). */
const BBOX_WAIT_MS = 3000;
/** fetchPublishedDate tự hủy sau chừng này; trang giả không bao giờ trả lời. */
const PAGE_TIMEOUT_MS = 4000;
/** Chờ lần tải đầu tối đa (FIRST_LOAD_WAIT_MS trong places.service.ts). */
const FIRST_LOAD_WAIT_MS = 15_000;
/** Gemini + Google Maps giả của phương án dự phòng v1. */
const FALLBACK_MS = 500;

const HOST = 'e2e-speed.test';
/** Khung bao ngoài biển Cà Mau: không có địa điểm thật nào lẫn vào. */
const BBOX = { south: 8.3, west: 104.3, north: 8.4, east: 104.4 };
/** Khung bao thứ hai, không có địa điểm nào: để thấy phương án dự phòng. */
const EMPTY_BBOX = { south: 8.5, west: 104.5, north: 8.6, east: 104.6 };
/** Tên Overpass giả trả về cho v1 (được lưu vào danh mục). */
const OSM_NAMES = [
  'Mũi Cà Mau E2E',
  'Chợ Nổi E2E',
  'Rừng Đước E2E',
  'Quán Cua E2E',
  'Cà Phê Gió E2E',
];
/**
 * Tên agent giả trả về cho v2. Khác OSM_NAMES, để không khớp danh mục mà các
 * test v1 đã lưu trong cùng khung bao, nên đi qua nhánh Geocoding.
 */
const WEB_NAMES = [
  'Hòn Khoai E2E',
  'Bãi Bồi Đất Mũi E2E',
  'Đầm Thị Tường E2E',
  'Lẩu Mắm Bà Tư E2E',
  'Cà Phê Võng Đưa E2E',
];

describe('Tốc độ danh sách địa điểm (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let token: string;
  /** Kết thúc sớm mọi độ trễ giả còn treo khi test xong. */
  const stop = new AbortController();
  const realFetch = globalThis.fetch;

  const delay = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      stop.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });

  const overpassCalls = vi.fn();
  /** Đổi tạm trong test "Overpass chậm". */
  let overpassMs = OVERPASS_MS;
  const openData = {
    placesInBbox: vi.fn(async (): Promise<OverpassElement[]> => {
      overpassCalls();
      await delay(overpassMs);
      if (stop.signal.aborted) throw new Error('test đã kết thúc');
      return OSM_NAMES.map((name, i) => ({
        type: 'node',
        id: -9500 - i,
        lat: 8.35 + i * 0.005,
        lon: 104.35,
        tags: { name, tourism: 'attraction' },
      }));
    }),
    wikidata: vi.fn(async () => new Map()),
    listBoundaries: vi.fn(async () => []),
    // Hết test thì trả rỗng: vùng không có khung bao, chỉ ghi một dòng cảnh báo.
    searchPlaces: vi.fn(async () => {
      await delay(NOMINATIM_MS);
      return [];
    }),
  };

  /** Phương án dự phòng v1 (Gemini + Google Maps), giả: không gọi Gemini thật. */
  const fallbackFindPlaces = vi.fn(async () => {
    await delay(FALLBACK_MS);
    return {
      places: [
        {
          title: 'Dự phòng E2E',
          description: '',
          address: '',
          location: { lat: 8.55, lng: 104.55 },
          category: 'check_in' as const,
          tags: [],
          openHours: { open: '', close: '' },
        },
      ],
      sources: [],
    };
  });

  const findPlaces = vi.fn(async () => {
    await delay(SEARCH_MS);
    return {
      places: WEB_NAMES.map((title, i) => ({
        title,
        description: 'Địa điểm giả cho test tốc độ',
        address: '',
        location: { lat: 8.35 + i * 0.005, lng: 104.35 },
        category: 'check_in' as const,
        openHours: { open: '', close: '' },
      })),
      sources: [
        {
          title: 'Bài giả',
          uri: `https://blog.${HOST}/ca-mau`,
          content: `Nên ghé ${WEB_NAMES.join(', ')}.`,
          publishedAt: null,
        },
      ],
    };
  });

  const geocodeCalls: URL[] = [];
  /** Trang bài viết và Geocoding giả; mọi request khác đi ra mạng thật. */
  const fakeFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
    );
    if (url.host === `geocode.${HOST}`) {
      geocodeCalls.push(url);
      await delay(GEOCODE_MS);
      // Mỗi địa điểm một tọa độ riêng, không thì dedupe gộp làm một.
      const address = url.searchParams.get('address') ?? '';
      const i = WEB_NAMES.findIndex((name) => address.startsWith(name));
      return Response.json({
        status: 'OK',
        results: [
          {
            place_id: `gp-${i}`,
            types: ['point_of_interest'],
            geometry: { location: { lat: 8.351 + i * 0.01, lng: 104.36 } },
          },
        ],
      });
    }
    if (url.host === `blog.${HOST}`) {
      // Trang treo cho tới khi fetchPublishedDate tự hủy.
      return new Promise((_, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal!.reason as Error),
        ),
      );
    }
    return realFetch(input, init);
  };

  beforeAll(async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OpenDataService)
      .useValue(openData)
      .overrideProvider(PlaceSearchService)
      .useValue({ enabled: true, findPlaces })
      .overrideProvider(LangchainService)
      .useValue({ findPlaces: fallbackFindPlaces, planItinerary: vi.fn() })
      .overrideProvider(GOOGLE_CONFIG)
      .useValue({
        mapsApiKey: 'e2e',
        placesUrl: `https://places.${HOST}/v1`,
        geocodingUrl: `https://geocode.${HOST}/json`,
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    db = app.get(DataSource);
    const [user] = (await db.query(
      `INSERT INTO users (display_name) VALUES ('e2e-speed') RETURNING id`,
    )) as Array<{ id: string }>;
    token = app.get(JwtService).sign({ sub: user.id });
  });

  afterAll(async () => {
    stop.abort();
    await db?.query(`DELETE FROM users WHERE display_name = 'e2e-speed'`);
    await db?.query(`DELETE FROM regions WHERE source_key LIKE 'e2e:speed:%'`);
    await db?.query(
      `DELETE FROM places WHERE osm_id <= -9500 AND osm_id > -9600`,
    );
    await app?.close();
    vi.unstubAllGlobals();
  });

  /** Vùng test riêng; `withBbox: false` thì phải nhờ Nominatim (giả, rất chậm). */
  async function createRegion(
    key: string,
    {
      withBbox = true,
      bbox = BBOX,
    }: { withBbox?: boolean; bbox?: typeof BBOX } = {},
  ): Promise<string> {
    const [row] = (await db.query(
      `INSERT INTO regions (source_key, name, type, boundary_version, search_name,
                            bbox_south, bbox_west, bbox_north, bbox_east)
       VALUES ($1, $2, 'destination', 'current', $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        `e2e:speed:${key}`,
        `Vùng tốc độ ${key}`,
        `vung toc do ${key}`,
        ...(withBbox
          ? [bbox.south, bbox.west, bbox.north, bbox.east]
          : [null, null, null, null]),
      ],
    )) as Array<{ id: string }>;
    return row.id;
  }

  async function timed(path: string) {
    const started = Date.now();
    const response = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
    const ms = Date.now() - started;
    console.log(`[tốc độ] GET ${path} → ${response.status} trong ${ms} ms`);
    return { response, ms };
  }

  const placesFetchedAt = async (regionId: string) => {
    const [row] = (await db.query(
      `SELECT places_fetched_at FROM regions WHERE id = $1`,
      [regionId],
    )) as Array<{ places_fetched_at: Date | null }>;
    return row.places_fetched_at;
  };

  describe('v1 — danh mục OSM', () => {
    let regionId: string;

    beforeAll(async () => {
      regionId = await createRegion('v1');
    });

    it('vùng chưa từng tải: chờ Overpass một lần, rồi lưu lại', async () => {
      const { response, ms } = await timed(`/api/regions/${regionId}/places`);

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(OSM_NAMES.length);
      // Mốc so sánh: hai truy vấn Overpass nối tiếp.
      expect(ms).toBeGreaterThanOrEqual(2 * OVERPASS_MS);
      expect(ms).toBeLessThan(2 * OVERPASS_MS + DB_BUDGET_MS * 2);
      expect(await placesFetchedAt(regionId)).not.toBeNull();
    }, 30_000);

    it('vùng đã tải: chỉ còn truy vấn database, không gọi Overpass', async () => {
      const before = overpassCalls.mock.calls.length;
      const { response, ms } = await timed(
        `/api/regions/${regionId}/places?limit=20`,
      );

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(OSM_NAMES.length);
      expect(ms).toBeLessThan(DB_BUDGET_MS);
      expect(overpassCalls.mock.calls.length).toBe(before);
    }, 30_000);

    it('vùng quá hạn: trả dữ liệu đã lưu ngay, làm mới ở nền', async () => {
      await db.query(
        `UPDATE regions SET places_fetched_at = now() - interval '400 days' WHERE id = $1`,
        [regionId],
      );
      const stale = await placesFetchedAt(regionId);
      const before = overpassCalls.mock.calls.length;

      const { response, ms } = await timed(`/api/regions/${regionId}/places`);

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(OSM_NAMES.length);
      // Không chờ dù chỉ một lượt Overpass.
      expect(ms).toBeLessThan(Math.min(DB_BUDGET_MS, OVERPASS_MS));
      expect(overpassCalls.mock.calls.length).toBe(before + 1);

      // Lượt làm mới ở nền xong thì thời điểm tải được cập nhật.
      await vi.waitFor(
        async () =>
          expect((await placesFetchedAt(regionId))!.getTime()).toBeGreaterThan(
            stale!.getTime(),
          ),
        { timeout: 2 * OVERPASS_MS + 5000, interval: 500 },
      );
    }, 30_000);

    it('vùng được dựng sẵn (PlacesWarmer): lần mở đầu tiên đã nhanh', async () => {
      const warmed = await createRegion('v1-warm');
      expect(await app.get(PlacesService).warm(warmed)).toBe(true);

      const before = overpassCalls.mock.calls.length;
      const { response, ms } = await timed(`/api/regions/${warmed}/places`);

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(OSM_NAMES.length);
      expect(ms).toBeLessThan(DB_BUDGET_MS);
      expect(overpassCalls.mock.calls.length).toBe(before);
      // Dựng lại khi còn mới thì không tải gì.
      expect(await app.get(PlacesService).warm(warmed)).toBe(false);
    }, 30_000);
  });

  describe('v1 — Overpass chậm hoặc lỗi', () => {
    it('vùng chưa từng tải mà Overpass chậm: không chờ quá FIRST_LOAD_WAIT_MS, trả dự phòng', async () => {
      const regionId = await createRegion('v1-slow', { bbox: EMPTY_BBOX });
      overpassMs = 60_000;
      try {
        const { response, ms } = await timed(`/api/regions/${regionId}/places`);

        expect(response.status).toBe(200);
        expect(response.body.source).toBe('ai_google_maps');
        expect(ms).toBeGreaterThanOrEqual(FIRST_LOAD_WAIT_MS);
        expect(ms).toBeLessThan(
          FIRST_LOAD_WAIT_MS + FALLBACK_MS + DB_BUDGET_MS,
        );
      } finally {
        overpassMs = OVERPASS_MS;
      }
    }, 30_000);

    it('Overpass lỗi: trả dự phòng ngay, không chờ', async () => {
      const regionId = await createRegion('v1-down', { bbox: EMPTY_BBOX });
      openData.placesInBbox.mockRejectedValueOnce(
        new OpenDataError('Overpass đang lỗi ở mọi máy chủ'),
      );

      const { response, ms } = await timed(`/api/regions/${regionId}/places`);

      expect(response.status).toBe(200);
      expect(response.body.source).toBe('ai_google_maps');
      expect(ms).toBeLessThan(FALLBACK_MS + DB_BUDGET_MS);
    }, 30_000);
  });

  describe('v2 — tìm từ bài viết', () => {
    let regionId: string;

    beforeAll(async () => {
      regionId = await createRegion('v2');
    });

    it('lần đầu: không chờ trang bài viết treo, Geocoding chạy song song', async () => {
      const { response, ms } = await timed(
        `/api/v2/regions/${regionId}/places`,
      );

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(WEB_NAMES.length);
      expect(
        response.body.items.every(
          (item: { locationSource: string }) =>
            item.locationSource === 'geocoding',
        ),
      ).toBe(true);
      // Ngày đăng chưa đọc được trong DATES_WAIT_MS thì để trống, không chờ hết PAGE_TIMEOUT_MS.
      expect(response.body.groundingSources[0].publishedAt).toBeNull();
      expect(geocodeCalls).toHaveLength(WEB_NAMES.length);

      // Tìm + chờ ngày đăng có giới hạn + một lượt Geocoding (song song) + database.
      // Nếu chờ trang treo (≥ SEARCH_MS + PAGE_TIMEOUT_MS) hoặc gọi Geocoding
      // nối tiếp (≥ SEARCH_MS + DATES_WAIT_MS + 5 × GEOCODE_MS) thì đều vượt mốc này.
      const budget = SEARCH_MS + DATES_WAIT_MS + GEOCODE_MS + DB_BUDGET_MS;
      expect(budget).toBeLessThan(SEARCH_MS + PAGE_TIMEOUT_MS);
      expect(budget).toBeLessThan(
        SEARCH_MS + DATES_WAIT_MS + WEB_NAMES.length * GEOCODE_MS,
      );
      expect(ms).toBeLessThan(budget);
    }, 30_000);

    it('lần sau: kết quả tìm và tọa độ đều lấy từ cache', async () => {
      const geocodesBefore = geocodeCalls.length;
      const { response, ms } = await timed(
        `/api/v2/regions/${regionId}/places`,
      );

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(WEB_NAMES.length);
      expect(findPlaces).toHaveBeenCalledTimes(1);
      expect(geocodeCalls).toHaveLength(geocodesBefore);
      expect(ms).toBeLessThan(DB_BUDGET_MS);
    }, 30_000);

    it('đổi bộ lọc danh mục cũng không tìm lại hay geocode lại', async () => {
      const geocodesBefore = geocodeCalls.length;
      const { response, ms } = await timed(
        `/api/v2/regions/${regionId}/places?categories=check_in,food`,
      );

      expect(response.status).toBe(200);
      expect(findPlaces).toHaveBeenCalledTimes(1);
      expect(geocodeCalls).toHaveLength(geocodesBefore);
      expect(ms).toBeLessThan(DB_BUDGET_MS);
    }, 30_000);

    it('vùng chưa có khung bao: không chờ Nominatim chậm quá BBOX_WAIT_MS', async () => {
      const noBbox = await createRegion('v2-no-bbox', { withBbox: false });
      const geocodesBefore = geocodeCalls.length;

      const { response, ms } = await timed(`/api/v2/regions/${noBbox}/places`);

      expect(response.status).toBe(200);
      expect(response.body.items.length).toBeGreaterThan(0);
      // Tra tọa độ không giới hạn vùng (không gửi bounds) vì khung bao chưa có.
      const lookups = geocodeCalls.slice(geocodesBefore);
      expect(lookups.length).toBeGreaterThan(0);
      expect(lookups.every((url) => !url.searchParams.has('bounds'))).toBe(
        true,
      );
      expect(ms).toBeLessThan(
        SEARCH_MS + DATES_WAIT_MS + BBOX_WAIT_MS + GEOCODE_MS + DB_BUDGET_MS,
      );
      expect(ms).toBeLessThan(NOMINATIM_MS);
    }, 30_000);
  });
});
