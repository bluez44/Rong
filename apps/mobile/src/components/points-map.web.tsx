import { StyleSheet, Text, View } from 'react-native';

import type { PointsMapProps } from '@/components/points-map-shared';
import { Colors, Spacing, Type } from '@/constants/theme';

/** react-native-maps không chạy trên web; bản web chỉ dùng khi phát triển. */
export function PointsMap({ points, style }: PointsMapProps) {
  if (points.length === 0) return null;
  return (
    <View style={[styles.placeholder, style]}>
      <Text style={styles.text}>Bản đồ chỉ hiển thị trên app iOS và Android.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: Colors.light.backgroundElement, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  text: { ...Type.footnote, color: Colors.light.textSecondary },
});
