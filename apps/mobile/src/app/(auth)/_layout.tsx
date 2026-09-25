import { Stack } from 'expo-router';

import { Colors } from '@/constants/theme';

export const unstable_settings = { initialRouteName: 'login' };

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        // Header trong suốt: trên iOS 26 nút quay lại là kính gốc, nổi trên dải thông.
        headerTransparent: true,
        headerTitle: '',
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: Colors.light.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: Colors.light.background },
      }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" />
      <Stack.Screen name="verify" />
    </Stack>
  );
}
