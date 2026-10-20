import type { PlaceCategory, PlaceDetail, PlaceImage } from '@rong/shared-types';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '@/components/glass';
import { GooglePlaceContentBlock } from '@/components/google-place-content';
import { PointsMap } from '@/components/points-map';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { AdaptiveImage } from '@/components/ui/adaptive-image';
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
  // Ngón tay đang trên bản đồ thì tắt cuộn trang để kéo dọc di chuyển bản đồ.
  const [mapTouched, setMapTouched] = useState(false);

  const name = place?.name ?? params.name ?? 'Địa điểm';
  const category = place?.category ?? (params.category && params.category in CATEGORY_LABELS ? params.category : null);

  return (
    // Chỉ chừa cạnh trên: nội dung cuộn xuống dưới thanh home.
    <Screen edges={['top']}>
      {/* Tên và danh mục nằm ngoài ScrollView nên luôn thấy khi cuộn. */}
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => router.back()}>
          <Glass shape="circle" interactive style={styles.backGlass}>
            <Icon name="back" color={Colors.light.text} />
          </Glass>
        </Pressable>
        <View style={styles.header}>
          {category ? (
            <View style={styles.category}>
              <Icon name={category} size={14} color={Colors.light.primary} />
              <Text style={styles.categoryLabel}>{CATEGORY_LABELS[category]}</Text>
            </View>
          ) : null}
          <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
            {name}
          </Text>
        </View>
        {place && params.regionId ? (
          <SaveButton place={place} region={{ id: params.regionId, name: params.regionName ?? 'Vùng đã chọn' }} />
        ) : (
          <View style={styles.backGlass} />
        )}
      </View>

      <ScrollView
        scrollEnabled={!mapTouched}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.eight }]}>
        {place ? (
          <View style={styles.facts}>
            {place.locationSource === 'ai' ? <ApproximateLocation /> : null}
            <Hours place={place} />
            {/* Địa chỉ của Rong (từ bài viết), ngay dưới giờ mở cửa. */}
            <View style={styles.addressRow}>
              <Icon name="pin" size={16} color={Colors.light.textSecondary} />
              <Text style={[styles.addressText, !place.address && styles.addressMissing]}>
                {place.address ?? 'Chưa tìm được địa chỉ'}
              </Text>
            </View>
          </View>
        ) : null}

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

        {place ? <PlaceBody place={place} regionId={params.regionId} onMapTouch={setMapTouched} /> : null}
      </ScrollView>
    </Screen>
  );
}

/** "zalopay.vn" từ link bài viết, bỏ "www.". */
function hostname(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  return (match?.[1] ?? url).replace(/^www\./i, '');
}

/**
 * Một khối giờ mở cửa: trạng thái + giờ hôm nay; bấm để xem cả tuần. Giờ từng
 * ngày của Google nếu có, không thì giờ thô từ bài viết (`openingHours`).
 */
function Hours({ place }: { place: PlaceDetail }) {
  const [expanded, setExpanded] = useState(false);
  const openNow = place.hours?.openNow ?? place.google?.openNow ?? null;
  const today = place.hours?.today ?? null;
  const week = place.google?.weekdayHours.length ? place.google.weekdayHours : null;
  const raw = !week && place.openingHours && place.openingHours !== today ? place.openingHours : null;
  const canExpand = Boolean(week || raw);

  if (openNow === null && !today && !canExpand) return null;

  const openLabel = openNow === true ? 'Đang mở' : openNow === false ? 'Đã đóng cửa' : null;
  const todayIndex = week?.length === 7 ? vietnamWeekdayIndex() : -1;

  return (
    <View>
      <Pressable
        disabled={!canExpand}
        accessibilityRole={canExpand ? 'button' : undefined}
        accessibilityState={canExpand ? { expanded } : undefined}
        accessibilityHint={canExpand ? 'Xem giờ mở cửa cả tuần' : undefined}
        onPress={() => setExpanded((v) => !v)}
        style={styles.hoursRow}>
        <Icon name="clock" size={16} color={Colors.light.textSecondary} />
        <Text style={styles.hoursText}>
          {openLabel ? (
            <Text style={{ color: openNow ? Colors.light.primary : Colors.light.danger }}>{openLabel}</Text>
          ) : null}
          {openLabel && today ? ' · ' : null}
          {today ?? (openLabel ? null : 'Giờ mở cửa')}
        </Text>
        {canExpand ? <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={16} color={Colors.light.textSecondary} /> : null}
      </Pressable>
      {expanded && week ? (
        <View style={styles.week}>
          {week.map((line, i) => (
            <Text key={line} style={[styles.weekLine, i === todayIndex && styles.weekToday]}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      {expanded && raw ? (
        <View style={styles.week}>
          <Text style={styles.weekLine}>{raw}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Thứ trong tuần theo giờ Việt Nam, Thứ Hai = 0 (thứ tự `weekdayHours` của Google). */
function vietnamWeekdayIndex(): number {
  const day = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCDay();
  return (day + 6) % 7;
}

function PlaceBody({
  place,
  regionId,
  onMapTouch,
}: {
  place: PlaceDetail;
  regionId?: string;
  onMapTouch: (active: boolean) => void;
}) {
  const { height } = useWindowDimensions();
  // Ảnh tải lỗi (link chết, chặn hotlink) thì bỏ hẳn, bản đồ đứng một mình.
  const [imageFailed, setImageFailed] = useState(false);
  const image = place.image && !imageFailed ? place.image : null;

  return (
    <>
      <View style={styles.actionGroup}>
        {/* Ảnh và bản đồ ghép một khối. Bản đồ vuốt/zoom được; chạm không mở Google Maps, việc đó để nút "Chỉ đường". */}
        {image || place.coordinates ? (
          <View style={styles.media}>
            {image ? <ArticleImage image={image} onError={() => setImageFailed(true)} /> : null}
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
                selectedKey={place.id}
                onTouchActiveChange={onMapTouch}
                style={{ height: Math.round(height * (image ? MAP_HEIGHT_WITH_IMAGE : MAP_HEIGHT_RATIO)) }}
              />
            ) : null}
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button
            label="Chỉ đường"
            variant={regionId ? 'glass' : 'primary'}
            onPress={() => Linking.openURL(directionsUrl(place))}
            style={styles.action}
          />
          {place.website ? <Button label="Trang web" variant="glass" onPress={() => Linking.openURL(place.website!)} style={styles.action} /> : null}
        </View>
        {regionId ? <TripButton place={place} regionId={regionId} /> : null}
      </View>

      {place.description ? <Text style={styles.description}>{place.description}</Text> : null}

      <GoogleSection place={place} />

      {/* Link Google Maps (`sourceUrl`) nằm ở nút "Chỉ đường". */}
      <Text style={styles.attributionText}>Thông tin địa điểm: {place.attribution}</Text>
    </>
  );
}

/** Ảnh từ bài viết (hotlink), khung theo tỉ lệ ảnh, tên trang nguồn đè góc dưới. */
function ArticleImage({ image, onError }: { image: PlaceImage; onError: () => void }) {
  return (
    <View>
      <AdaptiveImage uri={image.url} fit="natural" onError={onError} />
      <Text style={styles.photoCredit} accessibilityRole="link" onPress={() => Linking.openURL(image.sourceUrl)}>
        Ảnh: {hostname(image.sourceUrl)}
      </Text>
    </View>
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
  if (place.googleStatus === 'ok' && place.google) return <GooglePlaceContentBlock content={place.google} showHours={false} />;
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

/** Bản đồ cao nửa màn hình; có ảnh phía trên thì thấp hơn để cả khối vừa mắt. */
const MAP_HEIGHT_RATIO = 0.5;
const MAP_HEIGHT_WITH_IMAGE = 0.35;

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.hairline,
  },
  backGlass: { width: MinTouch, alignItems: 'center', justifyContent: 'center' },
  header: { flex: 1, gap: Spacing.one },
  category: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.backgroundSelected,
  },
  categoryLabel: { ...Type.footnote, color: Colors.light.primary },
  title: { ...Type.title2, color: Colors.light.text },
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, gap: Spacing.six },
  facts: { gap: Spacing.two },
  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: 28 },
  hoursText: { ...Type.subhead, color: Colors.light.textSecondary, flexShrink: 1 },
  week: { marginTop: Spacing.one, marginLeft: 16 + Spacing.one, gap: 2 },
  weekLine: { ...Type.footnote, color: Colors.light.textSecondary },
  weekToday: { color: Colors.light.text, fontWeight: '600' },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  addressText: { ...Type.subhead, color: Colors.light.textSecondary, flex: 1 },
  addressMissing: { color: Colors.light.textDisabled },
  media: { borderRadius: Radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  photoCredit: {
    ...Type.caption,
    position: 'absolute',
    left: Spacing.two,
    bottom: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    color: '#fff',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  status: { paddingVertical: Spacing.six, alignItems: 'center' },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
  actionGroup: { gap: Spacing.three },
  actions: { flexDirection: 'row', gap: Spacing.three },
  action: { flex: 1 },
  description: { ...Type.body, color: Colors.light.text },
  attributionText: { ...Type.footnote, color: Colors.light.textSecondary },
});
