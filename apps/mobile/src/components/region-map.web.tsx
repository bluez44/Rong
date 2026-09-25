import { StyleSheet, Text, View } from 'react-native';

import type { RegionMapProps } from '@/components/region-map-shared';
import { Colors, Spacing, Type } from '@/constants/theme';

/**
 * react-native-maps không chạy trên web. Bản web chỉ dùng khi phát triển nên
 * giữ nền bản đồ trơn; danh sách địa điểm trong sheet vẫn dùng được.
 */
export function RegionMap({ topInset }: RegionMapProps) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.placeholder, { paddingTop: topInset + Spacing.twelve }]}>
      <Text style={styles.text}>Bản đồ chỉ hiển thị trên app iOS và Android.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: Colors.light.backgroundElement, alignItems: 'center' },
  text: { ...Type.footnote, color: Colors.light.textSecondary },
});
