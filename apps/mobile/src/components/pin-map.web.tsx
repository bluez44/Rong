import { forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PinMapHandle, PinMapProps } from '@/components/pin-map-shared';
import { Colors, Spacing, Type } from '@/constants/theme';

/** Bản web chưa có bản đồ ghim: chỉ hiện thông báo, giống `region-map.web.tsx`. */
export const PinMap = forwardRef<PinMapHandle, PinMapProps>(function PinMap(_props, ref) {
  useImperativeHandle(ref, () => ({ goToMyLocation: async () => false }));
  return (
    <View style={styles.box}>
      <Text style={styles.text}>Ghim vị trí chưa hỗ trợ trên web. Hãy dùng app trên điện thoại.</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.six },
  text: { ...Type.body, color: Colors.light.textSecondary, textAlign: 'center' },
});
