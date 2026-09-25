import type { PlaceCategory } from '@rong/shared-types';
import { StyleSheet, Text, View } from 'react-native';

import { Glass } from '@/components/glass';
import { Icon } from '@/components/ui/icon';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';

type MapMarkerProps = {
  category: PlaceCategory;
  selected?: boolean;
  /** Tên hiện trên viên kính khi marker đang chọn. */
  label?: string;
};

/** Nội dung vẽ bên trong `<Marker>`. Không dùng ảnh Google (FR-2.2). */
export function MapMarker({ category, selected, label }: MapMarkerProps) {
  const size = selected ? 48 : 36;
  return (
    <View style={styles.wrap}>
      {selected && label ? (
        <Glass shape="capsule" variant="strong" style={styles.label}>
          <Text style={styles.labelText} numberOfLines={1}>
            {label}
          </Text>
        </Glass>
      ) : null}
      <View
        style={[
          styles.dot,
          Shadow.marker,
          { width: size, height: size },
          selected ? styles.dotSelected : styles.dotDefault,
        ]}>
        <Icon name={category} size={selected ? 24 : 18} color={selected ? Colors.light.onPrimary : Colors.light.primary} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing.one },
  label: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, maxWidth: 200 },
  labelText: { ...Type.subhead, color: Colors.light.text },
  dot: { borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  dotDefault: { backgroundColor: Colors.light.surface, borderColor: Colors.light.surface },
  dotSelected: { backgroundColor: Colors.light.primary, borderColor: Colors.light.surface },
});
