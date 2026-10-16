import type { ItineraryItem } from '@rong/shared-types';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '@/components/glass';
import { PointsMap } from '@/components/points-map';
import type { MapPoint } from '@/components/points-map-shared';
import { ApproximateLocation } from '@/components/ui/approximate-location';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Spacing, Type } from '@/constants/theme';
import { useItinerary } from '@/hooks/use-itineraries';
import { formatPlanDate, formatTime, MEAL_LABELS } from '@/lib/trip-format';

/** `day`: chỉ số ngày (từ 0) trong `itinerary.days`. */
type Params = { id: string; day?: string };

/** Một điểm dừng có tọa độ, đánh số theo thứ tự trên timeline của ngày. */
type Stop = { item: ItineraryItem; number: number };

/** Bản đồ các điểm dừng của một ngày trong lịch trình, mở từ card "Lộ trình ngày N". */
export default function ItineraryDayMapScreen() {
  const { id, day } = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const itinerary = useItinerary(id);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const dayIndex = Math.max(0, Number(day) || 0);
  const current = itinerary.data?.days[dayIndex] ?? itinerary.data?.days[0];
  const places = current?.items.map((item, idx) => ({ item, number: idx + 1 })).filter(({ item }) => item.placeId && item.place) ?? [];
  const stops: Stop[] = places.filter(({ item }) => item.place?.coordinates);
  const missing = places.length - stops.length;
  const points: MapPoint[] = stops.map(({ item, number }) => ({
    key: item.id,
    lat: item.place!.coordinates!.lat,
    lng: item.place!.coordinates!.lng,
    icon: stopIcon(item),
    label: item.place!.name,
    number,
    approximate: item.place!.locationSource === 'ai',
  }));
  const selected = stops.find(({ item }) => item.id === selectedKey) ?? null;
  const title = current ? `Ngày ${dayIndex + 1} · ${formatPlanDate(current.date)}` : 'Bản đồ lộ trình';

  return (
    <View style={styles.screen}>
      <PointsMap
        points={points}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        edgePadding={{ top: insets.top + 96, right: Spacing.eight, bottom: insets.bottom + 200, left: Spacing.eight }}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.two }]} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => router.back()}>
          <Glass shape="circle" interactive style={styles.backGlass}>
            <Icon name="back" color={Colors.light.text} />
          </Glass>
        </Pressable>
        <Glass shape="capsule" variant="strong" style={styles.titleGlass}>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        </Glass>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + Spacing.three }]} pointerEvents="box-none">
        {itinerary.status === 'loading' ? (
          <Glass shape="rounded" variant="strong" style={styles.card}>
            <ActivityIndicator color={Colors.light.primary} accessibilityLabel="Đang tải" />
          </Glass>
        ) : itinerary.status === 'error' && itinerary.error ? (
          <Notice
            tone="danger"
            title="Chưa tải được lịch trình"
            action={<Button label="Thử lại" variant="plain" size="sm" onPress={itinerary.reload} style={styles.inlineAction} />}>
            {itinerary.error.message}
          </Notice>
        ) : selected ? (
          <StopCard stop={selected} onClose={() => setSelectedKey(null)} />
        ) : (
          <Glass shape="rounded" variant="strong" style={styles.card}>
            <Text style={styles.hint}>
              {stops.length === 0
                ? 'Chưa có điểm nào trong ngày có vị trí trên bản đồ.'
                : `${stops.length} điểm dừng. Chạm vào một điểm để xem chi tiết.`}
            </Text>
            {missing > 0 ? <Text style={styles.meta}>{missing} điểm chưa có vị trí nên không hiện trên bản đồ.</Text> : null}
          </Glass>
        )}
      </View>
    </View>
  );
}

function StopCard({ stop, onClose }: { stop: Stop; onClose: () => void }) {
  const { item, number } = stop;
  const place = item.place!;
  const kind = item.kind === 'meal' && item.mealType ? MEAL_LABELS[item.mealType] : CATEGORY_LABELS[place.category as keyof typeof CATEGORY_LABELS];

  return (
    <Glass shape="rounded" variant="strong" style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.flex}>
          <Text style={styles.meta}>
            Điểm {number} · {formatTime(item.startsAt)}–{formatTime(item.endsAt)}
            {kind ? ` · ${kind}` : ''}
          </Text>
          <Text style={styles.name}>{place.name}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Đóng" hitSlop={8} onPress={onClose}>
          <Icon name="close" size={18} color={Colors.light.textSecondary} />
        </Pressable>
      </View>
      {place.address ? (
        <View style={styles.addressRow}>
          <Icon name="pin" size={14} color={Colors.light.textSecondary} />
          <Text style={[styles.meta, styles.flex]}>{place.address}</Text>
        </View>
      ) : null}
      {place.locationSource === 'ai' ? <ApproximateLocation compact /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Xem chi tiết ${place.name}`}
        hitSlop={{ top: 8, bottom: 8 }}
        onPress={() => router.push({ pathname: '/place/[id]', params: { id: item.placeId!, name: place.name } })}
        style={({ pressed }) => [styles.detail, pressed && styles.pressed]}>
        <Text style={styles.detailLabel}>Xem chi tiết</Text>
        <Icon name="forward" size={14} color={Colors.light.primary} />
      </Pressable>
    </Glass>
  );
}

function stopIcon(item: ItineraryItem): IconName {
  if (item.kind === 'meal') return 'food';
  const category = item.place?.category;
  return category && category in CATEGORY_LABELS ? (category as IconName) : 'pin';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.light.backgroundElement },
  flex: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  backGlass: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
  titleGlass: { flexShrink: 1, minHeight: MinTouch, justifyContent: 'center', paddingHorizontal: Spacing.four },
  title: { ...Type.headline, color: Colors.light.text },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Spacing.four },
  card: { padding: Spacing.four, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  name: { ...Type.headline, color: Colors.light.text },
  meta: { ...Type.footnote, color: Colors.light.textSecondary },
  hint: { ...Type.subhead, color: Colors.light.text },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  detail: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, marginTop: Spacing.one },
  detailLabel: { ...Type.subhead, color: Colors.light.primary },
  pressed: { opacity: 0.6 },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
});
