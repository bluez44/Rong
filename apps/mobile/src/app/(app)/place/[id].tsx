import type { PlaceCategory, PlaceDetail } from '@rong/shared-types';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '@/components/glass';
import { GooglePlaceContentBlock } from '@/components/google-place-content';
import { PointsMap } from '@/components/points-map';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { ApproximateLocation } from '@/components/ui/approximate-location';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';
import { usePlaceDetail } from '@/hooks/use-place-detail';
import { useSavedPlaces } from '@/lib/saved-places';
import { tripDraft, useTripDraft } from '@/lib/trip-draft';

/**
 * `name` và `category` truyền từ danh sách để phần đầu hiện ngay trong lúc tải.
 * `regionId`/`regionName` có khi mở từ bản đồ vùng hoặc "Muốn đi": bật nút thêm
 * vào lịch trình của vùng đó, và là vùng được ghi khi thả tim.
 */
type Params = { id: string; name?: string; category?: PlaceCategory; regionId?: string; regionName?: string };

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
        {place && params.regionId ? (
          <SaveButton place={place} region={{ id: params.regionId, name: params.regionName ?? 'Vùng đã chọn' }} />
        ) : null}
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
          {place?.locationSource === 'ai' ? <ApproximateLocation /> : null}
          {place ? <Summary place={place} /> : null}
          {/* Địa chỉ của Rong (từ bài viết), ngay dưới giờ mở cửa. */}
          {place ? (
            <View style={styles.addressRow}>
              <Icon name="pin" size={16} color={Colors.light.textSecondary} />
              <Text style={[styles.addressText, !place.address && styles.addressMissing]}>
                {place.address ?? 'Chưa tìm được địa chỉ'}
              </Text>
            </View>
          ) : null}
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

/** Giờ mở cửa hôm nay: dữ liệu riêng của app (giờ trong bài viết), không phải của Google. */
function Summary({ place }: { place: PlaceDetail }) {
  const openState = place.hours?.openNow === true ? 'Đang mở' : place.hours?.openNow === false ? 'Đã đóng cửa' : null;

  if (!openState && !place.hours?.today) return null;

  return (
    <View style={styles.summary}>
      <View style={styles.hoursToday}>
        <Icon name="clock" size={16} />
        <Text style={styles.meta}>
          {openState ? <Text style={{ color: place.hours?.openNow ? Colors.light.primary : Colors.light.danger }}>{openState}</Text> : null}
          {openState && place.hours?.today ? ' · ' : null}
          {place.hours?.today}
        </Text>
      </View>
    </View>
  );
}

function PlaceBody({ place, regionId }: { place: PlaceDetail; regionId?: string }) {
  const openDirections = () => Linking.openURL(directionsUrl(place));

  return (
    <>
      <View style={styles.actionGroup}>
        {regionId ? <TripButton place={place} regionId={regionId} /> : null}
        <View style={styles.actions}>
          <Button label="Chỉ đường" variant={regionId ? 'glass' : 'primary'} onPress={openDirections} style={styles.action} />
          {place.website ? <Button label="Trang web" variant="glass" onPress={() => Linking.openURL(place.website!)} style={styles.action} /> : null}
        </View>
      </View>

      {place.coordinates ? (
        <PointsMap
          points={[
            {
              key: place.id,
              lat: place.coordinates.lat,
              lng: place.coordinates.lng,
              icon: place.category,
              label: place.name,
              approximate: place.locationSource === 'ai',
            },
          ]}
          interactive={false}
          onPress={openDirections}
          style={styles.miniMap}
        />
      ) : null}

      {place.description ? <Text style={styles.description}>{place.description}</Text> : null}

      {/* Giờ của Rong (bài viết / OSM cũ) chỉ hiện khi Google không có giờ từng ngày, để khỏi hai bảng giờ lệch nhau. */}
      {place.openingHours && !place.google?.weekdayHours.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Giờ mở cửa</Text>
          <Text style={styles.body}>{place.openingHours}</Text>
        </View>
      ) : null}

      <GoogleSection place={place} />

      {/* Link Google Maps (`sourceUrl`) nằm ở nút "Chỉ đường". */}
      <Text style={styles.attributionText}>Thông tin địa điểm: {place.attribution}</Text>
    </>
  );
}

/** Nút tim "Muốn đi" (FR-9.1). */
function SaveButton({ place, region }: { place: PlaceDetail; region: { id: string; name: string } }) {
  const saved = useSavedPlaces();
  const active = saved.isSaved(place.id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active ? 'Bỏ khỏi Muốn đi' : 'Lưu vào Muốn đi'}
      accessibilityState={{ selected: active }}
      onPress={() => saved.toggle({ id: place.id, name: place.name, category: place.category }, region)}>
      <Glass shape="circle" interactive style={styles.backGlass}>
        <Icon name={active ? 'heartFill' : 'heart'} color={active ? Colors.light.danger : Colors.light.text} />
      </Glass>
    </Pressable>
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

/**
 * Đã ghép Google: chỉ đường bằng place_id, không cần tọa độ (server không lấy lại tọa độ
 * Google đã hết hạn cho màn này). Chưa ghép: `sourceUrl` là link Google Maps tìm theo tên,
 * Google tự tìm đúng chỗ, thường sát hơn tọa độ AI.
 */
function directionsUrl(place: PlaceDetail): string {
  if (place.googlePlaceId) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.name)}&destination_place_id=${encodeURIComponent(place.googlePlaceId)}`;
  }
  return place.sourceUrl;
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
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
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  addressText: { ...Type.subhead, color: Colors.light.textSecondary, flex: 1 },
  addressMissing: { color: Colors.light.textDisabled },
  miniMap: { height: 160, borderRadius: Radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  summary: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.four },
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
  attributionText: { ...Type.footnote, color: Colors.light.textSecondary },
});
