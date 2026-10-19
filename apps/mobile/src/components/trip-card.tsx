import type { ItinerarySummary } from '@rong/shared-types';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { formatDateRange, PLANNER_LABELS } from '@/lib/trip-format';

export function isPastTrip(trip: ItinerarySummary) {
  return Date.parse(trip.endsAt) < Date.now();
}

/** Thẻ một lịch trình (tab Chuyến đi, màn chi tiết nhóm). Bấm để mở lịch trình. */
export function TripCard({ trip }: { trip: ItinerarySummary }) {
  const past = isPastTrip(trip);
  const dates = formatDateRange(trip.startsAt, trip.endsAt);
  const heading = trip.regionName.toLocaleUpperCase('vi-VN');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${trip.regionName}, ${dates}, ${trip.dayCount} ngày`}
      accessibilityHint={past ? 'Mở lại lịch trình đã đi' : 'Xem lịch trình'}
      onPress={() => router.push({ pathname: '/itinerary/[id]', params: { id: trip.id, regionName: trip.regionName } })}
      style={({ pressed }) => [styles.tripCard, past && styles.tripCardPast, pressed && styles.pressed]}>
      <View style={[styles.tripBand, past && styles.tripBandPast]}>
        <View style={styles.tripBandLabel}>
          <View style={[styles.tripBandDot, past && styles.tripBandDotPast]} />
          <Text style={styles.tripBandText}>{heading} · VI HÀNH</Text>
        </View>
        <Text style={styles.tripStatus}>{past ? 'Lật lại ký ức' : 'Sắp tới'}</Text>
      </View>

      <View style={styles.tripBody}>
        <View style={styles.tripMainRow}>
          <View style={[styles.tripIcon, past && styles.tripIconPast]}>
            <Icon name="calendar" size={20} color={past ? Palette.charcoalMuted : Palette.forest700} />
          </View>
          <View style={styles.tripText}>
            <Text style={styles.tripDestination} numberOfLines={1}>{trip.regionName}</Text>
            <Text style={styles.tripDates}>{dates} · {trip.dayCount} ngày</Text>
          </View>
        </View>

        <View style={styles.tripDivider} />

        <View style={styles.tripMetaRow}>
          <View style={styles.plannerPill}>
            <Icon name="sparkles" size={12} color={Palette.terracotta700} />
            <Text style={styles.plannerText}>{PLANNER_LABELS[trip.planner]}</Text>
          </View>
          <Text style={styles.tripGroup} numberOfLines={1}>{trip.groupName ?? 'Lịch trình cá nhân'}</Text>
        </View>
        <View style={styles.tripPreview}>
          <View style={styles.previewDot} />
          <Text style={styles.previewText} numberOfLines={1}>Mở lịch trình</Text>
          <Text style={styles.previewAction}>Xem lịch →</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tripCard: {
    overflow: 'hidden', borderRadius: Radius.lg, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: Palette.parchment200,
  },
  tripCardPast: { backgroundColor: Palette.parchment100 },
  tripBand: {
    minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: Spacing.two, paddingHorizontal: Spacing.three, backgroundColor: Palette.forest900,
  },
  tripBandPast: { backgroundColor: Palette.charcoalMuted },
  tripBandLabel: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flex: 1 },
  tripBandDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Palette.turmeric500 },
  tripBandDotPast: { backgroundColor: Palette.parchment300 },
  tripBandText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, letterSpacing: 0.7, color: Palette.onPine },
  tripStatus: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, color: Palette.turmeric100 },
  tripBody: { padding: Spacing.three, gap: Spacing.three },
  tripMainRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  tripIcon: {
    width: 42, height: 42, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.md, backgroundColor: Palette.forest100,
  },
  tripIconPast: { backgroundColor: Palette.parchment200 },
  tripText: { flex: 1, gap: 2 },
  tripDestination: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, lineHeight: 25, color: Palette.charcoal },
  tripDates: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: Palette.charcoalMuted },
  tripDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Palette.parchment300 },
  tripMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  plannerPill: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.one,
    paddingHorizontal: Spacing.two, paddingVertical: Spacing.one,
    borderRadius: Radius.pill, backgroundColor: Palette.terracotta100,
  },
  plannerText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, color: Palette.terracotta700 },
  tripGroup: { flex: 1, textAlign: 'right', fontFamily: 'PlusJakartaSans_400Regular', fontSize: 9, color: Palette.charcoalMuted },
  tripPreview: {
    minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    paddingHorizontal: Spacing.two, borderRadius: Radius.sm, backgroundColor: Palette.parchment100,
  },
  previewDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Palette.forest700 },
  previewText: { flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: Palette.charcoalMuted },
  previewAction: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: Palette.terracotta700 },
  pressed: { opacity: 0.76 },
});
