import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AppModule } from '../src/app.module.js';
import {
  addDays,
  vietnamDate,
} from '../src/modules/recommendations/draft-dates.js';
import {
  OpenMeteoClient,
  WEATHER_CONFIG,
} from '../src/modules/weather/open-meteo.client.js';
import type {
  ArchiveDaily,
  ForecastDaily,
} from '../src/modules/weather/weather-rules.js';
import { WeatherService } from '../src/modules/weather/weather.service.js';

describe('Thời tiết theo ngày (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let token: string;
  let seq = 0;
  const forecast =
    vi.fn<(lat: number, lng: number) => Promise<ForecastDaily>>();
  const archive =
    vi.fn<
      (
        lat: number,
        lng: number,
        from: string,
        to: string,
      ) => Promise<ArchiveDaily>
    >();
  const today = vietnamDate(new Date());

  /** 16 ngày từ hôm nay: mưa, 30°/23°, 70%. */
  const fakeForecast = async (): Promise<ForecastDaily> => {
    const time = Array.from({ length: 16 }, (_, i) => addDays(today, i));
    return {
      time,
      weather_code: time.map(() => 61),
      temperature_2m_max: time.map(() => 30.4),
      temperature_2m_min: time.map(() => 22.6),
      precipitation_probability_max: time.map(() => 70),
    };
  };
  /** Mỗi ngày 28°/20°; tháng 6–10 ngày nào cũng mưa 5 mm, các tháng khác khô. */
  const fakeArchive = async (
    _lat: number,
    _lng: number,
    from: string,
    to: string,
  ): Promise<ArchiveDaily> => {
    const time: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) time.push(d);
    return {
      time,
      temperature_2m_max: time.map(() => 28),
      temperature_2m_min: time.map(() => 20),
      precipitation_sum: time.map((d) =>
        Number(d.slice(5, 7)) >= 6 && Number(d.slice(5, 7)) <= 10 ? 5 : 0,
      ),
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OpenMeteoClient)
      .useValue({ forecast, archive })
      .overrideProvider(WEATHER_CONFIG)
      .useValue({
        enabled: true,
        forecastUrl: '',
        archiveUrl: '',
        contactEmail: 'e2e@rong.local',
        climateDailyLimit: 25,
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
      `INSERT INTO users (display_name) VALUES ('e2e-weather') RETURNING id`,
    )) as Array<{ id: string }>;
    token = app.get(JwtService).sign({ sub: user.id });
  });

  beforeEach(() => {
    forecast.mockReset().mockImplementation(fakeForecast);
    archive.mockReset().mockImplementation(fakeArchive);
  });

  afterAll(async () => {
    await db?.query(
      `DELETE FROM regions WHERE source_key LIKE 'e2e:weather:%'`,
    );
    await db?.query(`DELETE FROM users WHERE display_name = 'e2e-weather'`);
    await app?.close();
  });

  /** Mỗi test một vùng riêng để cache dự báo của test trước không lẫn vào. */
  const newRegion = async (): Promise<string> => {
    const [row] = (await db.query(
      `INSERT INTO regions (source_key, name, type, boundary_version, search_name, bbox_south, bbox_west, bbox_north, bbox_east)
       VALUES ($1, 'Vùng e2e thời tiết', 'destination', 'current', 'vung e2e thoi tiet', 11.85, 108.35, 12.05, 108.55)
       RETURNING id`,
      [`e2e:weather:${Date.now()}:${++seq}`],
    )) as Array<{ id: string }>;
    return row.id;
  };

  const get = (path: string) =>
    request(app.getHttpServer())
      .get(`/api${path}`)
      .set('Authorization', `Bearer ${token}`);

  it('khoảng ngày vắt qua mốc 16 ngày: 3 ngày dự báo rồi 3 ngày khí hậu', async () => {
    const id = await newRegion();
    const from = addDays(today, 13);
    const to = addDays(today, 18);
    const res = await get(
      `/regions/${id}/weather?from=${from}&to=${to}`,
    ).expect(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.attribution).toBe('Open-Meteo.com');
    expect(res.body.days.map((d: { kind: string }) => d.kind)).toEqual([
      'forecast',
      'forecast',
      'forecast',
      'climate',
      'climate',
      'climate',
    ]);
    expect(res.body.days[0]).toEqual({
      date: from,
      kind: 'forecast',
      condition: 'rain',
      tempMax: 30,
      tempMin: 23,
      rainChance: 70,
    });
    const far = res.body.days[3];
    const wet =
      Number(far.date.slice(5, 7)) >= 6 && Number(far.date.slice(5, 7)) <= 10;
    expect(far).toEqual({
      date: addDays(today, 16),
      kind: 'climate',
      condition: wet ? 'rain' : 'clear',
      tempMax: 28,
      tempMin: 20,
      rainChance: wet ? 100 : 0,
    });
    // Tâm bbox của vùng.
    expect(forecast.mock.calls[0][0]).toBeCloseTo(11.95);
    expect(forecast.mock.calls[0][1]).toBeCloseTo(108.45);
  });

  it('khí hậu chỉ tính một lần, kể cả hai request song song; lần sau đọc region_climate', async () => {
    const id = await newRegion();
    const from = addDays(today, 30);
    const to = addDays(today, 31);
    await Promise.all([
      get(`/regions/${id}/weather?from=${from}&to=${to}`).expect(200),
      get(`/regions/${id}/weather?from=${from}&to=${to}`).expect(200),
    ]);
    const again = await get(
      `/regions/${id}/weather?from=${from}&to=${to}`,
    ).expect(200);
    expect(again.body.days).toHaveLength(2);
    expect(archive).toHaveBeenCalledTimes(1);
    expect(forecast).not.toHaveBeenCalled();
    const [{ count }] = (await db.query(
      `SELECT count(*)::int AS count FROM region_climate WHERE region_id = $1`,
      [id],
    )) as Array<{ count: number }>;
    expect(count).toBe(12);
  });

  it('dự báo song song chỉ gọi Open-Meteo một lần', async () => {
    const id = await newRegion();
    const q = `from=${today}&to=${addDays(today, 1)}`;
    await Promise.all([
      get(`/regions/${id}/weather?${q}`).expect(200),
      get(`/regions/${id}/weather?${q}`).expect(200),
    ]);
    await get(`/regions/${id}/weather?${q}`).expect(200);
    expect(forecast).toHaveBeenCalledTimes(1);
  });

  it('archive treo vẫn trả các ngày dự báo trong vài giây', async () => {
    const id = await newRegion();
    archive.mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    const res = await get(
      `/regions/${id}/weather?from=${addDays(today, 14)}&to=${addDays(today, 17)}`,
    ).expect(200);
    expect(Date.now() - started).toBeLessThan(8000);
    expect(res.body.status).toBe('ready');
    expect(res.body.days.map((d: { kind: string }) => d.kind)).toEqual([
      'forecast',
      'forecast',
    ]);
  }, 15_000);

  it('Open-Meteo lỗi → 200 unavailable, không có ngày nào', async () => {
    const id = await newRegion();
    forecast.mockRejectedValue(new Error('down'));
    const res = await get(
      `/regions/${id}/weather?from=${today}&to=${addDays(today, 1)}`,
    ).expect(200);
    expect(res.body).toMatchObject({ status: 'unavailable', days: [] });
  });

  it('bỏ ngày đã qua', async () => {
    const id = await newRegion();
    const res = await get(
      `/regions/${id}/weather?from=${addDays(today, -3)}&to=${addDays(today, 1)}`,
    ).expect(200);
    expect(res.body.days.map((d: { date: string }) => d.date)).toEqual([
      today,
      addDays(today, 1),
    ]);
  });

  it('ngày sai → 400 (INVALID_DATES khi đảo ngược hoặc quá 14 ngày)', async () => {
    const id = await newRegion();
    const reversed = await get(
      `/regions/${id}/weather?from=${addDays(today, 2)}&to=${today}`,
    ).expect(400);
    expect(reversed.body.code).toBe('INVALID_DATES');
    const tooLong = await get(
      `/regions/${id}/weather?from=${today}&to=${addDays(today, 14)}`,
    ).expect(400);
    expect(tooLong.body.code).toBe('INVALID_DATES');
    await get(`/regions/${id}/weather?from=abc&to=${today}`).expect(400);
  });

  it('vùng không có → 404 REGION_NOT_FOUND; chưa đăng nhập → 401', async () => {
    const res = await get(
      `/regions/00000000-0000-4000-8000-000000000000/weather?from=${today}&to=${today}`,
    ).expect(404);
    expect(res.body.code).toBe('REGION_NOT_FOUND');
    await request(app.getHttpServer())
      .get(
        `/api/regions/${await newRegion()}/weather?from=${today}&to=${today}`,
      )
      .expect(401);
  });

  it('summarizeTrip: tóm tắt cả chuyến; dự báo treo thì null sau waitMs', async () => {
    const weather = app.get(WeatherService);
    const id = await newRegion();
    const startsAt = new Date(
      `${addDays(today, 2)}T08:00:00+07:00`,
    ).toISOString();
    const endsAt = new Date(
      `${addDays(today, 3)}T18:00:00+07:00`,
    ).toISOString();
    expect(await weather.summarizeTrip(id, startsAt, endsAt)).toEqual({
      kind: 'forecast',
      condition: 'rain',
      tempMin: 23,
      tempMax: 30,
      rainChance: 70,
    });

    const slow = await newRegion();
    forecast.mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    expect(await weather.summarizeTrip(slow, startsAt, endsAt, 200)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
