import type { PlaceListItem } from '@rong/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';

type PlaceRowProps = {
  place: PlaceListItem;
  selected?: boolean;
  onPress: () => void;
  /** Mở màn chi tiết (F5). Chỉ hiện ở dòng đang chọn, vì chạm dòng là để định vị trên bản đồ (FR-2.7). */
  onOpenDetail?: () => void;
  /**
   * Nút tròn bên phải: "Thêm vào lịch trình" (FR-2.9), hoặc "Chọn làm nơi lưu trú"
   * với điểm lưu trú (FR-2.12). `active` là đã thêm/đã chọn.
   */
  tripAction?: { active: boolean; onPress: () => void };
};

/**
 * Một địa điểm trong bottom sheet (FR-2.9). Luôn trên nền đặc. Thumbnail là
 * glyph danh mục, không dùng ảnh Google (PRD 7.4).
 */
export function PlaceRow({ place, selected, onPress, onOpenDetail, tripAction }: PlaceRowProps) {
  const isStay = place.category === 'stay';
  const tripLabel = !tripAction
    ? null
    : isStay
      ? tripAction.active ? 'Bỏ chọn nơi lưu trú' : 'Chọn làm nơi lưu trú'
      : tripAction.active ? 'Bỏ khỏi lịch trình' : 'Thêm vào lịch trình';
  const actions = [
    ...(onOpenDetail ? [{ name: 'openDetail', label: 'Xem chi tiết' }] : []),
    ...(tripAction && tripLabel ? [{ name: 'trip', label: tripLabel }] : []),
  ];
  const meta = [CATEGORY_LABELS[place.category], hoursLabel(place.hours)].filter(Boolean).join(' · ');
  const score = Math.round(place.compositeScore);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={`${place.name}, ${meta}, điểm ${score} trên 100${tripAction?.active ? isStay ? ', nơi lưu trú của chuyến đi' : ', đã thêm vào lịch trình' : ''}`}
      // Cả dòng là một phần tử với trình đọc màn hình nên các nút bên trong được đưa ra thành hành động.
      accessibilityActions={actions.length ? actions : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'openDetail') onOpenDetail?.();
        if (e.nativeEvent.actionName === 'trip') tripAction?.onPress();
      }}
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
        {selected && onOpenDetail ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Xem chi tiết ${place.name}`}
            hitSlop={{ top: 8, bottom: 8 }}
            onPress={onOpenDetail}
            style={({ pressed }) => [styles.detail, pressed && styles.detailPressed]}>
            <Text style={styles.detailLabel}>Xem chi tiết</Text>
            <Icon name="forward" size={14} color={Colors.light.primary} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.side}>
        <Text style={styles.score} importantForAccessibility="no">
          {score}
        </Text>
        {tripAction && tripLabel ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${tripLabel}: ${place.name}`}
            hitSlop={(MinTouch - TRIP_BUTTON) / 2}
            onPress={tripAction.onPress}
            style={({ pressed }) => [styles.trip, tripAction.active && styles.tripActive, pressed && styles.detailPressed]}>
            <Icon
              name={tripAction.active ? 'check' : isStay ? 'stay' : 'add'}
              size={16}
              color={tripAction.active ? Colors.light.onPrimary : Colors.light.primary}
            />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

/** "Đang mở · 07:00–17:00". Bỏ phần nào API trả null. */
function hoursLabel(hours: PlaceListItem['hours']): string | null {
  if (!hours) return null;
  const state = hours.openNow === true ? 'Đang mở' : hours.openNow === false ? 'Đã đóng cửa' : null;
  return [state, hours.today].filter(Boolean).join(' · ') || null;
}

const TRIP_BUTTON = 32;

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
  detail: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, marginTop: Spacing.two },
  detailPressed: { opacity: 0.6 },
  detailLabel: { ...Type.subhead, color: Colors.light.primary },
  side: { alignItems: 'flex-end', gap: Spacing.two },
  score: { ...Type.numeric, color: Colors.light.primary, minWidth: 28, textAlign: 'right', paddingTop: 2 },
  trip: {
    width: TRIP_BUTTON,
    height: TRIP_BUTTON,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.light.primary,
    backgroundColor: Colors.light.surface,
  },
  tripActive: { backgroundColor: Colors.light.primary },
});
