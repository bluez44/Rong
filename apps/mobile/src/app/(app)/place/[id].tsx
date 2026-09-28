import type { PlaceCategory, PlaceDetail } from '@rong/shared-types';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '@/components/glass';
import { GooglePlaceContentBlock } from '@/components/google-place-content';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';
import { usePlaceDetail } from '@/hooks/use-place-detail';
import { tripDraft, useTripDraft } from '@/lib/trip-draft';

/**
 * `name` và `category` truyền từ danh sách để phần đầu hiện ngay trong lúc tải.
 * `regionId` có khi mở từ bản đồ vùng: bật nút thêm vào lịch trình của vùng đó.
 */
type Params = { id: string; name?: string; category?: PlaceCategory; regionId?: string };

export default function PlaceDetailScreen() {
  const params = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const detail = usePlaceDetail(params.id);
  const place = detail.place;

  const name = place?.name ?? params.name ?? 'Địa điểm';
  const category = place?.category ?? (params.category && params.category in CATEGORY_LABELS ? params.category : null);

  return (
    // Chỉ chừa cạnh trên: nội dung cuộn xuống dưới thanh home.
    <Screen edges={['top']}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => router.back()}>
          <Glass shape="circle" interactive style={styles.backGlass}>
            <Icon name="back" color={Colors.light.text} />
          </Glass>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.eight }]}>
        <View style={styles.header}>
          {category ? (
            <View style={styles.category}>
              <Icon name={category} size={16} color={Colors.light.primary} />
              <Text style={styles.categoryLabel}>{CATEGORY_LABELS[category]}</Text>
            </View>
          ) : null}
          <Text style={styles.title} accessibilityRole="header">
            {name}
          </Text>
          {place ? <Summary place={place} /> : null}
        </View>

        {detail.status === 'loading' && !place ? (
          <View style={styles.status}>
            <ActivityIndicator color={Colors.light.primary} accessibilityLabel="Đang tải" />
          </View>
        ) : null}

        {detail.status === 'error' && detail.error ? (
          <Notice
            tone="danger"
            title={detail.error.code === 'PLACE_NOT_FOUND' ? 'Không tìm thấy địa điểm' : 'Chưa tải được địa điểm'}
            action={
              detail.error.code === 'PLACE_NOT_FOUND' ? null : (
                <Button label="Thử lại" variant="plain" size="sm" onPress={detail.retry} style={styles.inlineAction} />
              )
            }>
            {detail.error.message}
          </Notice>
        ) : null}

        {place ? <PlaceBody place={place} regionId={params.regionId} /> : null}
      </ScrollView>
    </Screen>
  );
}

/** Điểm Rong và giờ mở cửa hôm nay: dữ liệu riêng của app, không phải của Google. */
function Summary({ place }: { place: PlaceDetail }) {
  const score = Math.round(place.compositeScore);
  const openState = place.hours?.openNow === true ? 'Đang mở' : place.hours?.openNow === false ? 'Đã đóng cửa' : null;

  return (
    <View style={styles.summary}>
      <View style={styles.score} accessible accessibilityLabel={`Điểm Rong ${score} trên 100`}>
        <Text style={styles.scoreValue}>{score}</Text>
        <Text style={styles.scoreLabel}>điểm Rong</Text>
      </View>
      {openState || place.hours?.today ? (
        <View style={styles.hoursToday}>
          <Icon name="clock" size={16} />
          <Text style={styles.meta}>
            {openState ? <Text style={{ color: place.hours?.openNow ? Colors.light.primary : Colors.light.danger }}>{openState}</Text> : null}
            {openState && place.hours?.today ? ' · ' : null}
            {place.hours?.today}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function PlaceBody({ place, regionId }: { place: PlaceDetail; regionId?: string }) {
  return (
    <>
      <View style={styles.actionGroup}>
        {regionId ? <TripButton place={place} regionId={regionId} /> : null}
        <View style={styles.actions}>
          <Button label="Chỉ đường" variant={regionId ? 'glass' : 'primary'} onPress={() => Linking.openURL(directionsUrl(place))} style={styles.action} />
          {place.website ? <Button label="Trang web" variant="glass" onPress={() => Linking.openURL(place.website!)} style={styles.action} /> : null}
        </View>
      </View>

      {place.description ? <Text style={styles.description}>{place.description}</Text> : null}

      {/* Giờ theo OpenStreetMap chỉ hiện khi Google không có giờ từng ngày, để khỏi hai bảng giờ lệch nhau. */}
      {place.openingHours && !place.google?.weekdayHours.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Giờ mở cửa</Text>
          <Text style={styles.body}>{place.openingHours}</Text>
        </View>
      ) : null}

      <GoogleSection place={place} />

      <View style={styles.attribution}>
        <Text style={styles.attributionText}>Thông tin địa điểm: {place.attribution}</Text>
        <Text style={styles.link} accessibilityRole="link" onPress={() => Linking.openURL(place.sourceUrl)}>
          Xem bản ghi gốc trên OpenStreetMap
        </Text>
      </View>
    </>
  );
}

/** Thêm vào lịch trình, hoặc chọn làm nơi lưu trú với điểm lưu trú (FR-2.12). */
function TripButton({ place, regionId }: { place: PlaceDetail; regionId: string }) {
  const draft = useTripDraft(regionId);
  const item = { id: place.id, name: place.name, category: place.category };

  if (place.category === 'stay') {
    const active = draft.accommodation?.id === place.id;
    return (
      <Button
        label={active ? 'Nơi lưu trú của chuyến đi ✓' : 'Chọn làm nơi lưu trú'}
        variant={active ? 'glass' : 'primary'}
        onPress={() => tripDraft.toggleAccommodation(regionId, item)}
      />
    );
  }
  const active = draft.places.some((p) => p.id === place.id);
  return (
    <Button
      label={active ? 'Đã thêm vào lịch trình ✓' : 'Thêm vào lịch trình'}
      variant={active ? 'glass' : 'primary'}
      onPress={() => tripDraft.togglePlace(regionId, item)}
    />
  );
}

function GoogleSection({ place }: { place: PlaceDetail }) {
  if (place.googleStatus === 'ok' && place.google) return <GooglePlaceContentBlock content={place.google} />;
  if (place.googleStatus === 'unavailable') {
    return <Notice title="Chưa tải được ảnh và đánh giá">Google Maps đang không phản hồi. Thử mở lại sau ít phút.</Notice>;
  }
  // not_found: địa điểm nhỏ hoặc mới, Google chưa có. Không cần báo lỗi.
  return null;
}

/** Mở Apple Maps trên iOS, Google Maps ở nơi khác, đều chỉ đường tới tọa độ riêng của app. */
function directionsUrl(place: PlaceDetail): string {
  const { lat, lng } = place.coordinates;
  if (Platform.OS === 'ios') {
    return `https://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(place.name)}`;
  }
  const placeId = place.google?.placeId ? `&destination_place_id=${place.google.placeId}` : '';
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}${placeId}`;
}

const styles = StyleSheet.create({
  topBar: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  backGlass: { width: MinTouch, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: Spacing.four, gap: Spacing.six },
  header: { gap: Spacing.two },
  category: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.backgroundSelected,
  },
  categoryLabel: { ...Type.subhead, color: Colors.light.primary },
  title: { ...Type.title1, color: Colors.light.text },
  summary: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.four },
  score: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one },
  scoreValue: { ...Type.title2, color: Colors.light.primary, fontVariant: ['tabular-nums'] },
  scoreLabel: { ...Type.subhead, color: Colors.light.textSecondary },
  hoursToday: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexShrink: 1 },
  meta: { ...Type.subhead, color: Colors.light.textSecondary },
  status: { paddingVertical: Spacing.six, alignItems: 'center' },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
  actionGroup: { gap: Spacing.three },
  actions: { flexDirection: 'row', gap: Spacing.three },
  action: { flex: 1 },
  description: { ...Type.body, color: Colors.light.text },
  section: { gap: Spacing.one },
  sectionTitle: { ...Type.headline, color: Colors.light.text },
  body: { ...Type.callout, color: Colors.light.text },
  attribution: { gap: Spacing.one },
  attributionText: { ...Type.footnote, color: Colors.light.textSecondary },
  link: { ...Type.footnote, color: Colors.light.primary },
});
