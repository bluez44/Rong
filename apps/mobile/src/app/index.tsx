import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Glass } from '@/components/glass';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function HomeScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="display">Cuối tuần này đi đâu?</ThemedText>
        <Glass shape="capsule" style={styles.search}>
          <ThemedText type="callout" themeColor="textSecondary">
            Tìm tỉnh, thành phố hoặc điểm đến
          </ThemedText>
        </Glass>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.twelve, gap: Spacing.six },
  search: { minHeight: 52, justifyContent: 'center', paddingHorizontal: Spacing.four },
});
