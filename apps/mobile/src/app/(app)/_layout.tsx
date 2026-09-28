import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      {/* Mờ dần thay vì trượt ngang: ô tìm kiếm trông như "nở" ra từ Trang chủ. */}
      <Stack.Screen name="search" options={{ animation: 'fade' }} />
      <Stack.Screen name="region/[id]" />
      <Stack.Screen name="place/[id]" />
      <Stack.Screen name="itinerary/new" />
      <Stack.Screen name="itinerary/[id]" />
    </Stack>
  );
}
