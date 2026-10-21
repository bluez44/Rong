import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useTabBarInset } from '@/components/floating-tab-bar';
import { Screen } from '@/components/screen';
import { isPastTrip, TripCard } from '@/components/trip-card';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { useItineraries } from '@/hooks/use-itineraries';
import { useSavedPlaces } from '@/lib/saved-places';

type TripFilter = 'all' | 'upcoming' | 'past';

export default function TripsScreen() {
  const tabBarInset = useTabBarInset();
  const trips = useItineraries();
  const { reload } = trips;
  const [filter, setFilter] = useState<TripFilter>('all');

  // Tải lại khi quay về tab (vừa tạo hoặc xóa lịch trình), trừ lần đầu vì hook đã tự tải.
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) reload();
      focused.current = true;
    }, [reload]),
  );

  const data = trips.data ?? [];
  const upcoming = data.filter((trip) => !isPastTrip(trip));
  const past = data.filter(isPastTrip);
  const visibleTrips = filter === 'upcoming' ? upcoming : filter === 'past' ? past : data;

  return (
    <Screen edges={['top']}>
      <FlatList
        data={visibleTrips}
        keyExtractor={(trip) => trip.id}
        renderItem={({ item }) => <TripCard trip={item} />}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: tabBarInset }]}
        ItemSeparatorComponent={() => <View style={styles.listGap} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headingRow}>
              <View style={styles.headingCopy}>
                <Text style={styles.title} accessibilityRole="header">Chuyến đi</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Lên lịch mới"
                onPress={() => router.push('/itinerary/new')}
                style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}>
                <Icon name="add" size={17} color={Palette.onPine} />
                <Text numberOfLines={1} style={styles.createButtonText}>Lên lịch mới</Text>
              </Pressable>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}
              accessibilityLabel="Lọc hành trình">
              <FilterChip label={`Tất cả hành trình  ${data.length}`} active={filter === 'all'} onPress={() => setFilter('all')} />
              <FilterChip label="Đang chuẩn bị" active={filter === 'upcoming'} onPress={() => setFilter('upcoming')} />
              <FilterChip label="Đã đi (Ký ức)" active={filter === 'past'} onPress={() => setFilter('past')} />
            </ScrollView>

            <SavedEntry />

            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle} accessibilityRole="header">Lịch trình đã xếp</Text>
              <Text style={styles.countPill}>{data.length} chuyến</Text>
            </View>
          </View>
        }
        ListEmptyComponent={<TripsEmptyState trips={trips} filter={filter} />}
        refreshControl={
          <RefreshControl refreshing={trips.status === 'refreshing'} onRefresh={reload} tintColor={Palette.forest700} />
        }
      />
    </Screen>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.filterChip, active && styles.filterChipActive, pressed && styles.pressed]}>
      <Text numberOfLines={1} style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

/** Lối vào danh sách "Muốn đi" (F9), kèm số lượng danh mục từ dữ liệu đã lưu. */
function SavedEntry() {
  const saved = useSavedPlaces();
  const cafes = saved.items.filter((place) => place.category === 'cafe').length;
  const otherPlaces = saved.items.length - cafes;
  const meta = saved.status === 'loading'
    ? 'Đang tải danh sách…'
    : saved.items.length
      ? `${cafes} quán cà phê · ${otherPlaces} địa điểm khác`
      : 'Thả tim những chỗ muốn ghé để xếp lịch sau';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Muốn đi, ${saved.items.length} địa điểm. ${meta}`}
      onPress={() => router.push('/saved')}
      style={({ pressed }) => [styles.savedCard, pressed && styles.pressed]}>
      <View style={styles.savedIcon}>
        <Icon name="heartFill" size={21} color={Palette.terracotta700} />
      </View>
      <View style={styles.savedCopy}>
        <View style={styles.savedTitleRow}>
          <Text style={styles.savedTitle}>Muốn đi</Text>
          <Text style={styles.savedCount}>{saved.items.length} địa điểm</Text>
        </View>
        <Text style={styles.savedDescription} numberOfLines={2}>
          Thả tim những chỗ muốn ghé để cuối tuần sẵn sàng xếp lịch lên đường.
        </Text>
        <View style={styles.savedMetaRow}>
          <Text style={styles.savedMeta}>{meta}</Text>
        </View>
      </View>
      <Icon name="forward" size={17} color={Palette.charcoalMuted} />
    </Pressable>
  );
}

function TripsEmptyState({ trips, filter }: { trips: ReturnType<typeof useItineraries>; filter: TripFilter }) {
  if (trips.status === 'loading') return <ActivityIndicator color={Palette.forest700} style={styles.loading} />;
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
  if (filter !== 'all') {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{filter === 'past' ? 'Chưa có chuyến đi đã qua' : 'Chưa có chuyến đi sắp tới'}</Text>
        <Text style={styles.emptyHint}>Đổi bộ lọc để xem các hành trình khác của bạn.</Text>
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>Trang sổ đầu tiên còn đang chờ</Text>
      <Text style={styles.emptyHint}>Chọn điểm đến và vài nơi muốn ghé, Rong sẽ giúp bạn xếp thành lịch trình.</Text>
      <Button label="Tìm điểm đến" onPress={() => router.push('/search')} style={styles.emptyAction} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.five },
  header: { gap: Spacing.four, marginBottom: Spacing.four },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  headingCopy: { gap: Spacing.one },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 29, lineHeight: 37, color: Palette.forest900 },
  createButton: {
    minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one,
    paddingHorizontal: Spacing.three, borderRadius: Radius.pill, backgroundColor: Palette.forest900,
  },
  createButtonText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: Palette.onPine },
  filters: { flexDirection: 'row', gap: Spacing.two, paddingRight: Spacing.four },
  filterChip: {
    minHeight: 36, justifyContent: 'center', paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill, backgroundColor: Palette.parchment200,
  },
  filterChipActive: { backgroundColor: Palette.forest900 },
  filterText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: Palette.charcoalMuted },
  filterTextActive: { color: Palette.onPine },
  savedCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.three,
    padding: Spacing.three, borderRadius: Radius.lg, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: Palette.parchment200,
  },
  savedIcon: {
    width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.md, backgroundColor: Palette.terracotta100,
  },
  savedCopy: { flex: 1, gap: Spacing.one },
  savedTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  savedTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: Palette.forest900 },
  savedCount: {
    overflow: 'hidden', paddingHorizontal: Spacing.two, paddingVertical: 2,
    borderRadius: Radius.pill, backgroundColor: Palette.terracotta100,
    fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, color: Palette.terracotta700,
  },
  savedDescription: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, lineHeight: 15, color: Palette.charcoalMuted },
  savedMetaRow: { flexDirection: 'row', alignItems: 'center' },
  savedMeta: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, color: Palette.forest700 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  sectionTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: Palette.charcoal },
  countPill: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: Palette.charcoalMuted },
  listGap: { height: Spacing.three },
  loading: { paddingVertical: Spacing.six },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
  empty: {
    gap: Spacing.two, marginTop: Spacing.two, padding: Spacing.four,
    borderRadius: Radius.lg, backgroundColor: '#FFFFFF', alignItems: 'flex-start',
  },
  emptyTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 17, color: Palette.forest900 },
  emptyHint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, lineHeight: 18, color: Palette.charcoalMuted },
  emptyAction: { marginTop: Spacing.one },
  pressed: { opacity: 0.76 },
});
