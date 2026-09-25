import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Colors, Spacing } from '@/constants/theme';

/** Màn bản đồ vùng và danh sách địa điểm — làm ở bước sau. Hiện chỉ nhận vùng đã chọn. */
export default function RegionScreen() {
  const { name } = useLocalSearchParams<{ id: string; name?: string }>();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <ThemedText type="title1">{name ?? 'Vùng đã chọn'}</ThemedText>
        <ThemedText type="callout" themeColor="textSecondary">
          Bản đồ và danh sách địa điểm của vùng này sẽ có ở bản sau.
        </ThemedText>
        <Button label="Quay lại" variant="plain" style={styles.back} onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.light.background },
  body: { padding: Spacing.four, gap: Spacing.two },
  back: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
});
