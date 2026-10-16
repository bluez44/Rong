import { Stack } from 'expo-router';

import { SheetHost } from '@/components/ui/sheet-portal';
import { SavedPlacesProvider } from '@/lib/saved-places';
import { useIncomingShare } from '@/lib/share-intent';

function IncomingShare() {
  useIncomingShare();
  return null;
}

export default function AppLayout() {
  return (
    // Danh sách "Muốn đi" dùng chung cho các tab và màn đẩy lên, theo phiên đăng nhập.
    <SavedPlacesProvider>
      <IncomingShare />
      {/* Bottom sheet vẽ ở đây, phủ mọi màn của nhóm, trong các provider mà nội dung sheet dùng. */}
      <SheetHost>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          {/* Mờ dần thay vì trượt ngang: ô tìm kiếm trông như "nở" ra từ Trang chủ. */}
          <Stack.Screen name="search" options={{ animation: 'fade' }} />
          <Stack.Screen name="region/[id]" />
          <Stack.Screen name="place/[id]" />
          <Stack.Screen name="place/google/[googlePlaceId]" />
          <Stack.Screen name="itinerary/new" />
          <Stack.Screen name="itinerary/[id]" />
          <Stack.Screen name="itinerary/day-map" />
          <Stack.Screen name="saved" />
          <Stack.Screen name="share-import/[id]" />
        </Stack>
      </SheetHost>
    </SavedPlacesProvider>
  );
}
