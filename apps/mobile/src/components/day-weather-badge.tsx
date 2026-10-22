import type { WeatherDay } from '@rong/shared-types';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Icon } from '@/components/ui/icon';
import { Colors, Palette, Radius, Spacing, Type } from '@/constants/theme';
import { formatPlanDate } from '@/lib/trip-format';
import { formatTemps, rainText, WEATHER_ATTRIBUTION, WEATHER_ICONS, WEATHER_LABELS } from '@/lib/weather';

/** Badge thời tiết của ngày đang xem; bấm mở sheet giải thích. */
export function DayWeatherBadge({ day }: { day: WeatherDay }) {
  const [open, setOpen] = useState(false);
  const climate = day.kind === 'climate';
  const rain = rainText(day);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Thời tiết: ${WEATHER_LABELS[day.condition]}, ${formatTemps(day)}`}
        onPress={() => setOpen(true)}
        style={[styles.badge, climate && styles.badgeClimate]}>
        <Icon name={WEATHER_ICONS[day.condition]} size={14} color={climate ? Colors.light.textSecondary : Palette.forest900} />
        <Text style={[styles.badgeText, climate && styles.dim]}>{formatTemps(day)}</Text>
      </Pressable>
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        header={<ThemedText type="title2">Thời tiết {formatPlanDate(day.date)}</ThemedText>}>
        <View style={styles.sheetBody}>
          <View style={styles.sheetRow}>
            <Icon name={WEATHER_ICONS[day.condition]} size={28} color={Palette.forest900} />
            <Text style={styles.sheetMain}>
              {WEATHER_LABELS[day.condition]} · {formatTemps(day)}
            </Text>
          </View>
          {rain ? (
            <Text style={styles.sheetText}>
              {climate ? `Tháng này ${rain} (${day.rainChance}% số ngày có mưa).` : `Khả năng mưa ${rain}.`}
            </Text>
          ) : null}
          <Text style={styles.sheetText}>
            {climate
              ? 'Ngày còn xa nên đây là thời tiết thường gặp trong tháng (trung bình 10 năm), không phải dự báo. Dự báo có khi còn ≤ 16 ngày.'
              : 'Dự báo cho cả vùng, cập nhật vài giờ một lần.'}
          </Text>
          <Text style={styles.attribution}>{WEATHER_ATTRIBUTION}</Text>
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: Palette.parchment100,
    borderWidth: 1,
    borderColor: Palette.parchment100,
  },
  badgeClimate: { borderStyle: 'dashed', borderColor: Palette.mist200, backgroundColor: Palette.parchment50 },
  badgeText: { ...Type.caption, fontSize: 12, color: Palette.forest900 },
  dim: { color: Colors.light.textSecondary },
  sheetBody: { gap: Spacing.three, paddingBottom: Spacing.four },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sheetMain: { ...Type.headline, color: Palette.forest900 },
  sheetText: { ...Type.body, color: Colors.light.text },
  attribution: { ...Type.caption, color: Colors.light.textSecondary },
});
