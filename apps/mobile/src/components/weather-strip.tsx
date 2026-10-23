import type { WeatherDay } from '@rong/shared-types';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Icon } from '@/components/ui/icon';
import { Colors, Palette, Radius, Spacing, Type } from '@/constants/theme';
import { useRegionWeather } from '@/hooks/use-region-weather';
import { formatPlanDate } from '@/lib/trip-format';
import { CLIMATE_NOTE, formatTemps, rainText, WEATHER_ATTRIBUTION, WEATHER_ICONS, WEATHER_LABELS } from '@/lib/weather';

type WeatherStripProps = { regionId?: string; from: string | null; to: string | null };

/** Dải thời tiết từng ngày dưới ô chọn ngày. Không có dữ liệu thì không chiếm chỗ. */
export function WeatherStrip({ regionId, from, to }: WeatherStripProps) {
  const { weather, loading } = useRegionWeather(regionId, from, to);
  if (loading) {
    return (
      <View style={styles.row} accessibilityLabel="Đang tải thời tiết">
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.chip, styles.skeleton]} />
        ))}
      </View>
    );
  }
  if (!weather) return null;
  const hasClimate = weather.days.some((d) => d.kind === 'climate');
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {weather.days.map((day) => (
          <WeatherDayChip key={day.date} day={day} />
        ))}
      </ScrollView>
      {hasClimate ? <Text style={styles.note}>{CLIMATE_NOTE}</Text> : null}
      <Text style={styles.attribution}>{WEATHER_ATTRIBUTION}</Text>
    </View>
  );
}

/** Một ngày: thứ/ngày, icon, nhiệt độ, mưa. Ngày khí hậu viền đứt, màu nhạt. */
function WeatherDayChip({ day }: { day: WeatherDay }) {
  const climate = day.kind === 'climate';
  const rain = rainText(day);
  const label = [
    formatPlanDate(day.date),
    WEATHER_LABELS[day.condition],
    formatTemps(day),
    rain ? `mưa ${rain}` : null,
    climate ? 'khí hậu thường gặp, không phải dự báo' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={[styles.chip, climate && styles.chipClimate]} accessible accessibilityLabel={label}>
      <Text style={styles.date}>{formatPlanDate(day.date)}</Text>
      <Icon name={WEATHER_ICONS[day.condition]} size={22} color={climate ? Colors.light.textSecondary : Palette.forest900} />
      <Text style={[styles.temps, climate && styles.dim]}>{formatTemps(day)}</Text>
      {rain ? (
        <View style={styles.rainRow}>
          <Icon name="drop" size={11} color={Colors.light.textSecondary} />
          <Text style={styles.rain}>{rain}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  row: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.one },
  chip: {
    width: 88,
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.mist200,
    backgroundColor: Palette.surface,
  },
  chipClimate: { borderStyle: 'dashed', backgroundColor: Palette.parchment50 },
  skeleton: { height: 84, backgroundColor: Palette.parchment100, borderColor: Palette.parchment100 },
  date: { ...Type.caption, color: Colors.light.textSecondary },
  temps: { ...Type.subhead, color: Palette.forest900 },
  dim: { color: Colors.light.textSecondary },
  rainRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  rain: { ...Type.caption, fontSize: 11, color: Colors.light.textSecondary },
  note: { ...Type.caption, color: Colors.light.textSecondary },
  attribution: { ...Type.caption, fontSize: 10, color: Colors.light.textSecondary },
});
