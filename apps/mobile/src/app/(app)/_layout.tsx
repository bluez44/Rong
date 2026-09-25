import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      {/* Mờ dần thay vì trượt ngang: ô tìm kiếm trông như "nở" ra từ Trang chủ. */}
      <Stack.Screen name="search" options={{ animation: 'fade' }} />
      <Stack.Screen name="region/[id]" />
    </Stack>
  );
}
