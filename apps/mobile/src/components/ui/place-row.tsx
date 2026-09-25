import type { PlaceListItem } from '@rong/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';

type PlaceRowProps = {
  place: PlaceListItem;
  selected?: boolean;
  onPress: () => void;
};

/**
 * Một địa điểm trong bottom sheet (FR-2.9). Luôn trên nền đặc. Thumbnail là
 * glyph danh mục, không dùng ảnh Google (PRD 7.4).
 */
export function PlaceRow({ place, selected, onPress }: PlaceRowProps) {
  const meta = [CATEGORY_LABELS[place.category], hoursLabel(place.hours)].filter(Boolean).join(' · ');
  const score = Math.round(place.compositeScore);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={`${place.name}, ${meta}, điểm ${score} trên 100`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, (pressed || selected) && styles.highlighted]}>
      <View style={styles.thumb}>
        <Icon name={place.category} size={22} color={Colors.light.primary} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {place.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
        {place.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {place.description}
          </Text>
        ) : null}
      </View>
      <Text style={styles.score} importantForAccessibility="no">
        {score}
      </Text>
    </Pressable>
  );
}

/** "Đang mở · 07:00–17:00". Bỏ phần nào API trả null. */
function hoursLabel(hours: PlaceListItem['hours']): string | null {
  if (!hours) return null;
  const state = hours.openNow === true ? 'Đang mở' : hours.openNow === false ? 'Đã đóng cửa' : null;
  return [state, hours.today].filter(Boolean).join(' · ') || null;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    minHeight: MinTouch + 20,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  highlighted: { backgroundColor: Colors.light.backgroundSelected },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: Radius.sm + 2,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.backgroundSelected,
  },
  body: { flex: 1, gap: 2 },
  name: { ...Type.headline, color: Colors.light.text },
  meta: { ...Type.subhead, color: Colors.light.textSecondary },
  description: { ...Type.footnote, color: Colors.light.textSecondary, marginTop: 2 },
  score: { ...Type.numeric, color: Colors.light.primary, minWidth: 28, textAlign: 'right', paddingTop: 2 },
});
