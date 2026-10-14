import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';

export const APPROXIMATE_LOCATION_NOTE =
  'Chưa tìm thấy địa điểm này trên Google Maps. Vị trí do AI ước đoán từ bài viết nên có thể lệch, thời gian di chuyển tới đây chỉ là ước tính.';

/**
 * Nhãn cho địa điểm có tọa độ AI ước đoán (`locationSource: 'ai'`).
 * `compact`: chỉ nhãn nhỏ, chạm để mở câu giải thích; mặc định luôn hiện cả câu.
 */
export function ApproximateLocation({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole={compact ? 'button' : undefined}
        accessibilityLabel={`Vị trí gần đúng. ${APPROXIMATE_LOCATION_NOTE}`}
        disabled={!compact}
        hitSlop={8}
        onPress={() => setOpen((v) => !v)}
        style={styles.badge}>
        <Icon name="pin" size={12} color={Colors.light.warning} />
        <Text style={styles.badgeText}>Vị trí gần đúng</Text>
      </Pressable>
      {open ? (
        <Text style={styles.note} importantForAccessibility="no">
          {APPROXIMATE_LOCATION_NOTE}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one, alignItems: 'flex-start' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.warningBackground,
  },
  badgeText: { ...Type.caption, color: Colors.light.warning },
  note: { ...Type.footnote, color: Colors.light.textSecondary },
});
