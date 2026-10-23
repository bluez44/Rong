import { Inject, Injectable } from '@nestjs/common';

import type { WeatherConfig } from '../../config/configuration.js';
import type { ArchiveDaily, ForecastDaily } from './weather-rules.js';

export const WEATHER_CONFIG = 'WEATHER_CONFIG';

const TIMEZONE = 'Asia/Ho_Chi_Minh';
const FORECAST_TIMEOUT_MS = 5000;
/** 10 năm dữ liệu ngày: phản hồi lớn, chờ lâu hơn (request người dùng chỉ đợi `CLIMATE_WAIT_MS`). */
const ARCHIVE_TIMEOUT_MS = 30_000;

/** Gọi HTTP tới Open-Meteo. Tách khỏi `WeatherService` để e2e thay bằng bản giả. */
@Injectable()
export class OpenMeteoClient {
  private readonly userAgent: string;

  constructor(@Inject(WEATHER_CONFIG) private readonly config: WeatherConfig) {
    this.userAgent = `Rong/0.1 (${config.contactEmail})`;
  }

  /** Dự báo 16 ngày, tính từ hôm nay (giờ Việt Nam). */
  async forecast(lat: number, lng: number): Promise<ForecastDaily> {
    const url = new URL('/v1/forecast', this.config.forecastUrl);
    url.search = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      daily:
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: TIMEZONE,
      forecast_days: '16',
    }).toString();
    const body = await this.getJson<{ daily: ForecastDaily }>(
      url.toString(),
      {},
      FORECAST_TIMEOUT_MS,
    );
    return body.daily;
  }

  /** Dữ liệu ngày ERA5 từ `from` tới `to` (YYYY-MM-DD). */
  async archive(
    lat: number,
    lng: number,
    from: string,
    to: string,
  ): Promise<ArchiveDaily> {
    const url = new URL('/v1/archive', this.config.archiveUrl);
    url.search = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      start_date: from,
      end_date: to,
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
      timezone: TIMEZONE,
    }).toString();
    const body = await this.getJson<{ daily: ArchiveDaily }>(
      url.toString(),
      {},
      ARCHIVE_TIMEOUT_MS,
    );
    return body.daily;
  }
  /**
   * Không dùng `ThrottledHttp`: nó xếp mọi request cùng host thành hàng, nên một request treo làm các vùng khác chờ
   * theo. Bản miễn phí cho 600 lượt/phút, các request chạy song song, mỗi cái có timeout riêng.
   */
  private async getJson<T>(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('User-Agent', this.userAgent);
    headers.set('Accept', 'application/json');
    const response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`${new URL(url).host} trả về HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
