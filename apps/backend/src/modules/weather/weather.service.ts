import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  RegionWeather,
  TripWeatherSummary,
  WeatherDay,
} from '@rong/shared-types';
import type { DataSource } from 'typeorm';

import type { WeatherConfig } from '../../config/configuration.js';
import { daysBetween, vietnamDate } from '../recommendations/draft-dates.js';
import type { Bbox } from '../regions/bbox.js';
import { RegionAreaService } from '../regions/region-area.service.js';
import { OpenMeteoClient, WEATHER_CONFIG } from './open-meteo.client.js';
import {
  CLIMATE_YEARS,
  climateDay,
  climateFromDaily,
  type ClimateMonth,
  DailyBudget,
  forecastDays,
  isForecastDate,
  summarizeDays,
  tripDates,
  WEATHER_MAX_RANGE_DAYS,
} from './weather-rules.js';

const FORECAST_TTL_MS = 3 * 60 * 60 * 1000;
/** Open-Meteo lỗi: nhớ lỗi chừng này, request trong lúc đó trả ngay thay vì chờ timeout và gọi thêm. */
const FORECAST_FAILURE_TTL_MS = 5 * 60 * 1000;
/** Request chờ dự báo tối đa chừng này rồi trả những gì có (spec: `unavailable` sau khoảng 5 s). */
const FORECAST_WAIT_MS = 5000;
/** Lần đầu một vùng cần khí hậu: request chỉ chờ chừng này, phần còn lại tính nền. */
const CLIMATE_WAIT_MS = 5000;
/** Feed gợi ý không chờ thời tiết lâu hơn chừng này. */
const SUMMARY_WAIT_MS = 2500;

type Point = { lat: number; lng: number };

/**
 * Thời tiết theo ngày của một vùng: dự báo Open-Meteo cho 16 ngày tới (cache 3 giờ trong bộ nhớ), khí hậu theo
 * tháng cho ngày xa hơn (tính một lần từ 10 năm ERA5, lưu `region_climate`). Lỗi nguồn không bao giờ ném ra ngoài:
 * ngày không có dữ liệu thì bỏ, không còn ngày nào thì `unavailable`.
 */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly forecasts = new Map<
    string,
    /** `days: null`: lần gọi gần nhất lỗi, giữ `FORECAST_FAILURE_TTL_MS`. */
    { today: string; at: number; days: Map<string, WeatherDay> | null }
  >();
  private readonly forecastInFlight = new Map<
    string,
    Promise<Map<string, WeatherDay> | null>
  >();
  private readonly climateInFlight = new Map<
    string,
    Promise<ClimateMonth[] | null>
  >();
  private readonly climateBudget: DailyBudget;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(WEATHER_CONFIG) private readonly config: WeatherConfig,
    private readonly client: OpenMeteoClient,
    private readonly areas: RegionAreaService,
  ) {
    this.climateBudget = new DailyBudget(config.climateDailyLimit);
  }

  async regionWeather(
    regionId: string,
    from: string,
    to: string,
    now = new Date(),
  ): Promise<RegionWeather> {
    const span = daysBetween(from, to);
    if (!(span >= 0 && span < WEATHER_MAX_RANGE_DAYS)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_DATES',
        message: `Ngày về phải từ ngày đi trở đi, tối đa ${WEATHER_MAX_RANGE_DAYS} ngày.`,
      });
    }
    const point = await this.regionPoint(regionId);
    const base: RegionWeather = {
      regionId,
      status: 'ready',
      days: [],
      attribution: 'Open-Meteo.com',
    };
    if (!this.config.enabled) return { ...base, status: 'unavailable' };

    const today = vietnamDate(now);
    const dates = tripDates(from, to, today);
    if (dates.length === 0) return base;
    const needForecast = dates.some((d) => isForecastDate(d, today));
    const needClimate = dates.some((d) => !isForecastDate(d, today));
    const [forecast, climate] = await Promise.all([
      needForecast
        ? withTimeout(
            this.forecast(regionId, point, today, now.getTime()),
            FORECAST_WAIT_MS,
          )
        : null,
      needClimate
        ? withTimeout(this.climate(regionId, point, today), CLIMATE_WAIT_MS)
        : null,
    ]);

    const days = dates.flatMap((date): WeatherDay[] => {
      if (isForecastDate(date, today)) {
        const day = forecast?.get(date);
        return day ? [day] : [];
      }
      const month = climate?.find((c) => c.month === Number(date.slice(5, 7)));
      return month ? [climateDay(date, month)] : [];
    });
    return { ...base, days, status: days.length > 0 ? 'ready' : 'unavailable' };
  }

  /** Tóm tắt cả chuyến cho thẻ gợi ý; lỗi hay quá `waitMs` thì null. */
  async summarizeTrip(
    regionId: string,
    startsAt: string,
    endsAt: string,
    waitMs = SUMMARY_WAIT_MS,
  ): Promise<TripWeatherSummary | null> {
    const from = vietnamDate(new Date(startsAt));
    const to = vietnamDate(new Date(endsAt));
    const weather = await withTimeout(
      this.regionWeather(regionId, from, to).catch((error: unknown) => {
        this.logger.warn(
          `Không lấy được thời tiết cho thẻ gợi ý (${regionId}): ${(error as Error).message}`,
        );
        return null;
      }),
      waitMs,
    );
    return weather ? summarizeDays(weather.days) : null;
  }

  /** Tâm bbox của vùng; chưa có bbox thì tâm vùng, cuối cùng nhờ RegionAreaService tính bbox. */
  private async regionPoint(regionId: string): Promise<Point> {
    const [row] = (await this.db.query(
      `SELECT CASE WHEN bbox_south IS NULL THEN NULL
                   ELSE ARRAY[bbox_south, bbox_west, bbox_north, bbox_east] END AS bbox,
              ST_Y(center) AS lat, ST_X(center) AS lng
         FROM regions WHERE id = $1`,
      [regionId],
    )) as Array<{ bbox: Bbox | null; lat: number | null; lng: number | null }>;
    if (!row) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'REGION_NOT_FOUND',
        message: 'Không tìm thấy vùng này.',
      });
    }
    if (row.bbox) return bboxCenter(row.bbox);
    if (row.lat !== null && row.lng !== null)
      return { lat: row.lat, lng: row.lng };
    return bboxCenter(await this.areas.ensure(regionId));
  }

  /** Dự báo 16 ngày của vùng, cache theo (vùng, hôm nay) 3 giờ; lỗi thì null. */
  private forecast(
    regionId: string,
    point: Point,
    today: string,
    nowMs: number,
  ): Promise<Map<string, WeatherDay> | null> {
    const cached = this.forecasts.get(regionId);
    const ttl = cached?.days ? FORECAST_TTL_MS : FORECAST_FAILURE_TTL_MS;
    if (cached && cached.today === today && nowMs - cached.at < ttl)
      return Promise.resolve(cached.days);
    let pending = this.forecastInFlight.get(regionId);
    if (!pending) {
      pending = this.client
        .forecast(point.lat, point.lng)
        .then((daily) => {
          const days = new Map(forecastDays(daily).map((d) => [d.date, d]));
          this.forecasts.set(regionId, { today, at: nowMs, days });
          return days;
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Không lấy được dự báo Open-Meteo (${regionId}): ${(error as Error).message}`,
          );
          this.forecasts.set(regionId, { today, at: nowMs, days: null });
          return null;
        })
        .finally(() => this.forecastInFlight.delete(regionId));
      this.forecastInFlight.set(regionId, pending);
    }
    return pending;
  }

  /** Khí hậu theo tháng; các request cùng vùng dùng chung một lần tính. Lỗi hay hết lượt trong ngày thì null. */
  private climate(
    regionId: string,
    point: Point,
    today: string,
  ): Promise<ClimateMonth[] | null> {
    let pending = this.climateInFlight.get(regionId);
    if (!pending) {
      pending = this.loadClimate(regionId, point, today)
        .catch((error: unknown) => {
          this.logger.warn(
            `Không tính được khí hậu (${regionId}): ${(error as Error).message}`,
          );
          return null;
        })
        .finally(() => this.climateInFlight.delete(regionId));
      this.climateInFlight.set(regionId, pending);
    }
    return pending;
  }

  private async loadClimate(
    regionId: string,
    point: Point,
    today: string,
  ): Promise<ClimateMonth[] | null> {
    const rows = (await this.db.query(
      `SELECT month, temp_max, temp_min, rain_day_ratio, precipitation_mm
         FROM region_climate WHERE region_id = $1 ORDER BY month`,
      [regionId],
    )) as Array<{
      month: number;
      temp_max: number;
      temp_min: number;
      rain_day_ratio: number;
      precipitation_mm: number;
    }>;
    if (rows.length > 0) {
      return rows.map((r) => ({
        month: Number(r.month),
        tempMax: Number(r.temp_max),
        tempMin: Number(r.temp_min),
        rainDayRatio: Number(r.rain_day_ratio),
        precipitationMm: Number(r.precipitation_mm),
      }));
    }
    if (!this.climateBudget.take(today)) {
      this.logger.warn(
        `Hết lượt tính khí hậu hôm nay (WEATHER_CLIMATE_DAILY_LIMIT), bỏ qua vùng ${regionId}.`,
      );
      return null;
    }
    const year = Number(today.slice(0, 4));
    const daily = await this.client.archive(
      point.lat,
      point.lng,
      `${year - CLIMATE_YEARS}-01-01`,
      `${year - 1}-12-31`,
    );
    const months = climateFromDaily(daily);
    if (months.length === 0) return null;
    await this.db.query(
      `INSERT INTO region_climate (region_id, month, temp_max, temp_min, rain_day_ratio, precipitation_mm)
       SELECT $1::uuid, m.month, m.temp_max, m.temp_min, m.rain_day_ratio, m.precipitation_mm
         FROM jsonb_to_recordset($2::jsonb)
           AS m(month smallint, temp_max real, temp_min real, rain_day_ratio real, precipitation_mm real)
       ON CONFLICT (region_id, month) DO NOTHING`,
      [
        regionId,
        JSON.stringify(
          months.map((m) => ({
            month: m.month,
            temp_max: m.tempMax,
            temp_min: m.tempMin,
            rain_day_ratio: m.rainDayRatio,
            precipitation_mm: m.precipitationMm,
          })),
        ),
      ],
    );
    return months;
  }
}

function bboxCenter([south, west, north, east]: Bbox): Point {
  return { lat: (south + north) / 2, lng: (west + east) / 2 };
}

/** Kết quả của `promise`, hoặc null nếu quá `ms` (promise vẫn chạy tiếp ở nền). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
