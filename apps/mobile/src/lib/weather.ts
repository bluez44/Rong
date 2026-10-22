import type { TripWeatherSummary, WeatherCondition, WeatherDay } from '@rong/shared-types';

import type { IconName } from '@/components/ui/icon';

export const WEATHER_ICONS: Record<WeatherCondition, IconName> = {
  clear: 'sun',
  partly_cloudy: 'partlyCloudy',
  cloudy: 'cloud',
  fog: 'fog',
  drizzle: 'drizzle',
  rain: 'rain',
  storm: 'storm',
};

export const WEATHER_LABELS: Record<WeatherCondition, string> = {
  clear: 'Nắng',
  partly_cloudy: 'Nắng có mây',
  cloudy: 'Nhiều mây',
  fog: 'Sương mù',
  drizzle: 'Mưa phùn',
  rain: 'Mưa rào',
  storm: 'Giông',
};

export const CLIMATE_NOTE =
  'Ngày còn xa: nhiệt độ và mưa thường gặp trong tháng, không phải dự báo. Dự báo có khi còn ≤ 16 ngày.';
export const WEATHER_ATTRIBUTION = 'Dữ liệu thời tiết: Open-Meteo';

/** `24°/17°`; khí hậu (hoặc tóm tắt có ngày khí hậu) thêm `~` vì không phải dự báo. */
export function formatTemps({ kind, tempMax, tempMin }: { kind: WeatherDay['kind'] | TripWeatherSummary['kind']; tempMax: number; tempMin: number }): string {
  return `${kind === 'forecast' ? '' : '~'}${tempMax}°/${tempMin}°`;
}

/** Dự báo: `60%`; khí hậu: "hay mưa" / "ít mưa". */
export function rainText({ kind, rainChance }: Pick<WeatherDay, 'kind' | 'rainChance'>): string | null {
  if (rainChance === null) return null;
  if (kind === 'forecast') return `${rainChance}%`;
  return rainChance >= 50 ? 'hay mưa' : 'ít mưa';
}

/** Mô tả trên thẻ gợi ý. */
export function summaryLabel(summary: TripWeatherSummary): string {
  if (summary.kind !== 'forecast' && (summary.rainChance ?? 0) >= 50) return 'Hay mưa';
  return WEATHER_LABELS[summary.condition];
}

/** YYYY-MM-DD theo giờ máy (app dùng ở Việt Nam). */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
