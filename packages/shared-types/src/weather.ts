/** Thời tiết theo ngày của chuyến (spec 2026-10-22-trip-weather). Nguồn: Open-Meteo. */
export type WeatherCondition = 'clear' | 'partly_cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'storm';

export interface WeatherDay {
  /** YYYY-MM-DD, giờ Việt Nam. */
  date: string;
  /** `forecast`: dự báo thật (≤ 16 ngày tới); `climate`: thường gặp của tháng, không phải dự báo. */
  kind: 'forecast' | 'climate';
  condition: WeatherCondition;
  /** °C, đã làm tròn. */
  tempMax: number;
  tempMin: number;
  /** forecast: % khả năng mưa; climate: % số ngày mưa trong tháng. */
  rainChance: number | null;
}

export interface RegionWeather {
  regionId: string;
  status: 'ready' | 'unavailable';
  days: WeatherDay[];
  attribution: 'Open-Meteo.com';
}

/** Tóm tắt cả chuyến, cho thẻ gợi ý. */
export interface TripWeatherSummary {
  kind: 'forecast' | 'climate' | 'mixed';
  condition: WeatherCondition;
  tempMin: number;
  tempMax: number;
  rainChance: number | null;
}
