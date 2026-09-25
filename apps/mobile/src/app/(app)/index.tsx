import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-context';
import { Glass } from '@/components/glass';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';

export default function HomeScreen() {
  const { session, signOut } = useAuth();
  const name = session?.user.displayName ?? session?.user.email;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          {name ? (
            <ThemedText type="subhead" themeColor="textSecondary">
              Chào {name}
            </ThemedText>
          ) : null}
          <ThemedText type="display">Cuối tuần này đi đâu?</ThemedText>
        </View>
        <Glass shape="capsule" style={styles.search}>
          <ThemedText type="callout" themeColor="textSecondary">
            Tìm tỉnh, thành phố hoặc điểm đến
          </ThemedText>
        </Glass>
        {/* Tạm đặt ở đây cho tới khi có màn Tài khoản. */}
        <Button label="Đăng xuất" variant="plain" style={styles.signOut} onPress={signOut} />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.twelve, gap: Spacing.six },
  header: { gap: Spacing.one },
  search: { minHeight: 52, justifyContent: 'center', paddingHorizontal: Spacing.four },
  signOut: { marginTop: 'auto', alignSelf: 'center' },
});
