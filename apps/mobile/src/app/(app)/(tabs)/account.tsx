import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';

export default function AccountScreen() {
  const { session, signOut } = useAuth();
  const user = session?.user;
  const name = user?.displayName ?? user?.email ?? 'Bạn';
  const initial = name.trim().charAt(0).toUpperCase();

  return (
    <Screen contentStyle={styles.content}>
      <Text style={styles.title} accessibilityRole="header">
        Tài khoản
      </Text>

      <View style={styles.card}>
        <View style={styles.avatar} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Text style={styles.initial}>{initial}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {user?.displayName && user.email ? (
            <Text style={styles.email} numberOfLines={1}>
              {user.email}
            </Text>
          ) : null}
        </View>
      </View>

      <Button label="Đăng xuất" variant="danger" style={styles.signOut} onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.six, gap: Spacing.six },
  title: { ...Type.title1, color: Colors.light.text },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.backgroundSelected,
  },
  initial: { ...Type.title2, color: Colors.light.primary },
  name: { ...Type.headline, color: Colors.light.text },
  email: { ...Type.subhead, color: Colors.light.textSecondary },
  signOut: { alignSelf: 'center' },
});
