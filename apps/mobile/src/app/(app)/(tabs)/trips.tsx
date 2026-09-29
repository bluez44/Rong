import type { ItinerarySummary } from '@rong/shared-types';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useItineraries } from '@/hooks/use-itineraries';
import { useSavedPlaces } from '@/lib/saved-places';
import { formatDateRange, PLANNER_LABELS } from '@/lib/trip-format';

export default function TripsScreen() {
  const trips = useItineraries();
  const { reload } = trips;

  // Tải lại khi quay về tab (vừa tạo hoặc xóa lịch trình), trừ lần đầu vì hook đã tự tải.
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) reload();
      focused.current = true;
    }, [reload]),
  );

  return (
    <Screen edges={['top']}>
      <FlatList
        data={trips.data ?? []}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <TripRow trip={item} />}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              Chuyến đi
            </Text>
            <SavedEntry />
          </View>
        }
        ListEmptyComponent={<EmptyState trips={trips} />}
        refreshControl={
          <RefreshControl refreshing={trips.status === 'refreshing'} onRefresh={reload} tintColor={Colors.light.primary} />
        }
      />
    </Screen>
  );
}

/** Lối vào danh sách "Muốn đi" (F9). */
function SavedEntry() {
  const saved = useSavedPlaces();
  const regions = new Set(saved.items.map((s) => s.regionId)).size;
  const meta =
    saved.status === 'loading'
      ? 'Đang tải…'
      : saved.items.length
        ? `${saved.items.length} địa điểm · ${regions} điểm đến`
        : 'Thả tim những chỗ muốn ghé để xếp lịch sau';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Muốn đi, ${meta}`}
      onPress={() => router.push('/saved')}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.icon}>
        <Icon name="heartFill" size={20} color={Colors.light.danger} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.name}>Muốn đi</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Icon name="forward" size={16} />
    </Pressable>
  );
}

function EmptyState({ trips }: { trips: ReturnType<typeof useItineraries> }) {
  if (trips.status === 'loading') return <ActivityIndicator color={Colors.light.primary} style={styles.loading} />;
  if (trips.status === 'error' && trips.error) {
    return (
      <Notice
        tone="danger"
        title="Chưa tải được chuyến đi"
        action={<Button label="Thử lại" variant="plain" size="sm" onPress={trips.reload} style={styles.inlineAction} />}>
        {trips.error.message}
      </Notice>
    );
  }
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>Chưa có chuyến đi nào</Text>
      <Text style={styles.hint}>Tìm một điểm đến, chọn vài chỗ muốn ghé rồi để AI xếp lịch giúp bạn.</Text>
      <Button label="Tìm điểm đến" onPress={() => router.push('/search')} style={styles.emptyAction} />
    </View>
  );
}

function TripRow({ trip }: { trip: ItinerarySummary }) {
  const dates = formatDateRange(trip.startsAt, trip.endsAt);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${trip.regionName}, ${dates}, ${trip.dayCount} ngày`}
      onPress={() => router.push({ pathname: '/itinerary/[id]', params: { id: trip.id, regionName: trip.regionName } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.icon}>
        <Icon name="calendar" size={20} color={Colors.light.primary} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.name} numberOfLines={1}>
          {trip.regionName}
        </Text>
        <Text style={styles.meta}>
          {dates} · {trip.dayCount} ngày · {PLANNER_LABELS[trip.planner]}
        </Text>
      </View>
      <Icon name="forward" size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.six, paddingBottom: Spacing.eight, gap: Spacing.two },
  header: { gap: Spacing.three, marginBottom: Spacing.five },
  title: { ...Type.title1, color: Colors.light.text },
  loading: { paddingVertical: Spacing.six },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
  empty: { gap: Spacing.two, paddingTop: Spacing.four, alignItems: 'flex-start' },
  emptyTitle: { ...Type.headline, color: Colors.light.text },
  hint: { ...Type.callout, color: Colors.light.textSecondary },
  emptyAction: { marginTop: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
  },
  pressed: { opacity: 0.7 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm + 2,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.backgroundSelected,
  },
  name: { ...Type.headline, color: Colors.light.text },
  meta: { ...Type.subhead, color: Colors.light.textSecondary },
});
