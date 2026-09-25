import type { RegionSearchResult } from '@rong/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';

type RegionResultProps = {
  region: RegionSearchResult;
  onPress: () => void;
};

/**
 * Một dòng kết quả tìm điểm đến. `displayName` đã kèm nhãn "(mới)"/"(cũ)"
 * (FR-1.9); dòng hai ghép ghi chú sáp nhập với tên vùng cha.
 */
export function RegionResult({ region, onPress }: RegionResultProps) {
  const detail = [region.note, region.parent?.displayName].filter(Boolean).join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${region.displayName}, ${detail}` : region.displayName}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.icon}>
        <Icon name={region.type === 'destination' ? 'pin' : 'layers'} size={18} color={Colors.light.primary} />
      </View>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {region.displayName}
        </Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Tiêu đề nhóm kết quả: "Tỉnh, thành phố", "Điểm đến du lịch", "Xã, phường". */
export function RegionResultGroup({ title }: { title: string }) {
  return (
    <Text accessibilityRole="header" style={styles.group}>
      {title}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouch + 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  pressed: { backgroundColor: Colors.light.backgroundElement },
  icon: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.backgroundSelected,
  },
  text: { flex: 1, gap: 2 },
  name: { ...Type.headline, color: Colors.light.text },
  detail: { ...Type.footnote, color: Colors.light.textSecondary },
  group: {
    ...Type.subhead,
    color: Colors.light.textSecondary,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.one,
  },
});
