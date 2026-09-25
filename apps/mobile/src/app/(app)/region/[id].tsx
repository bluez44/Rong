import type { PlaceCategory, PlaceListItem } from '@rong/shared-types';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '@/components/glass';
import { PlaceSheet, type SheetDetent } from '@/components/place-sheet';
import { RegionMap } from '@/components/region-map';
import { placeKey, type Bbox } from '@/components/region-map-shared';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { PlaceRow } from '@/components/ui/place-row';
import { CATEGORIES, CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Spacing, Type } from '@/constants/theme';
import { useRegionPlaces } from '@/hooks/use-region-places';

type Params = { id: string; name?: string; bbox?: string; lat?: string; lng?: string };

export default function RegionScreen() {
  const params = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const bbox = parseBbox(params.bbox);
  const center = params.lat && params.lng ? { lat: Number(params.lat), lng: Number(params.lng) } : null;

  const [categories, setCategories] = useState<PlaceCategory[]>([]);
  const places = useRegionPlaces(params.id, categories);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detent, setDetent] = useState<SheetDetent>('half');
  const [halfHeight, setHalfHeight] = useState(0);
  const list = useRef<FlatList<PlaceListItem>>(null);

  const toggle = (category: PlaceCategory) =>
    setCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : CATEGORIES.filter((c) => c === category || prev.includes(c)),
    );

  // Chọn trên bản đồ: mở sheet tới nửa màn hình và cuộn tới dòng tương ứng.
  const selectFromMap = (key: string) => {
    setSelectedKey(key);
    if (detent === 'collapsed') setDetent('half');
    const index = places.items.findIndex((p) => placeKey(p) === key);
    if (index >= 0) list.current?.scrollToIndex({ index, viewPosition: 0, animated: true });
  };

  // Chọn trong danh sách: hạ sheet xuống để thấy điểm trên bản đồ.
  const selectFromList = (place: PlaceListItem) => {
    setSelectedKey(placeKey(place));
    if (detent === 'full') setDetent('half');
  };

  const count = places.status === 'loading' ? 'Đang tải địa điểm…' : `${places.items.length}${places.nextCursor ? '+' : ''} địa điểm`;

  return (
    <View style={styles.screen}>
      <RegionMap
        bbox={bbox}
        center={center}
        places={places.items}
        selectedKey={selectedKey}
        onSelect={selectFromMap}
        topInset={insets.top + MinTouch}
        bottomInset={halfHeight}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Quay lại"
        onPress={() => router.back()}
        style={[styles.back, { top: insets.top + Spacing.two }]}>
        <Glass shape="circle" interactive style={styles.backGlass}>
          <Icon name="back" color={Colors.light.text} />
        </Glass>
      </Pressable>

      <PlaceSheet
        detent={detent}
        onDetentChange={setDetent}
        onHalfHeight={setHalfHeight}
        header={
          <View style={styles.sheetHeader}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
                {params.name ?? 'Vùng đã chọn'}
              </Text>
              <Text style={styles.count}>{count}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Chip label="Tất cả" selected={categories.length === 0} onPress={() => setCategories([])} />
              {CATEGORIES.map((c) => (
                <Chip key={c} label={CATEGORY_LABELS[c]} icon={c} selected={categories.includes(c)} onPress={() => toggle(c)} />
              ))}
            </ScrollView>
          </View>
        }>
        <FlatList
          ref={list}
          data={places.items}
          keyExtractor={placeKey}
          renderItem={({ item }) => <PlaceRow place={item} selected={placeKey(item) === selectedKey} onPress={() => selectFromList(item)} />}
          onEndReached={places.loadMore}
          onEndReachedThreshold={0.5}
          onScrollToIndexFailed={({ index }) => list.current?.scrollToOffset({ offset: index * 80, animated: true })}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<ListStatus places={places} />}
          ListFooterComponent={places.items.length > 0 ? <ListFooter places={places} /> : null}
        />
      </PlaceSheet>
    </View>
  );
}

type Places = ReturnType<typeof useRegionPlaces>;

/** Trạng thái khi chưa có dòng nào: đang tải lần đầu, lỗi, hoặc bộ lọc rỗng. */
function ListStatus({ places }: { places: Places }) {
  if (places.status === 'loading') {
    return (
      <View style={styles.status}>
        <ActivityIndicator color={Colors.light.primary} />
        {/* Lần đầu mở một vùng backend phải tải dữ liệu từ OpenStreetMap. */}
        <Text style={styles.hint}>Lần đầu mở vùng này có thể mất vài giây.</Text>
      </View>
    );
  }
  if (places.status === 'error' && places.error) return <ErrorNotice places={places} />;
  return (
    <View style={styles.status}>
      <Text style={styles.emptyTitle}>Chưa có địa điểm nào</Text>
      <Text style={styles.hint}>Thử bỏ bớt bộ lọc hoặc chọn “Tất cả”.</Text>
    </View>
  );
}

function ListFooter({ places }: { places: Places }) {
  return (
    <View style={styles.footer}>
      {places.status === 'loadingMore' ? <ActivityIndicator color={Colors.light.primary} /> : null}
      {places.status === 'error' && places.error ? <ErrorNotice places={places} /> : null}
      <Attribution places={places} />
    </View>
  );
}

function ErrorNotice({ places }: { places: Places }) {
  return (
    <View style={styles.status}>
      <Notice tone="danger" title="Chưa tải được địa điểm" action={<Button label="Thử lại" variant="plain" size="sm" onPress={places.retry} style={styles.inlineAction} />}>
        {places.error?.message}
      </Notice>
    </View>
  );
}

/** Ghi công nguồn: bắt buộc theo ODbL, và theo chính sách Google khi dùng kết quả dự phòng. */
function Attribution({ places }: { places: Places }) {
  if (!places.attribution) return null;
  return (
    <View style={styles.attribution}>
      <Text style={styles.attributionText}>{places.source === 'ai_google_maps' ? 'Google Maps' : places.attribution}</Text>
      {places.groundingSources.map((s) => (
        <Text key={s.uri} style={styles.link} accessibilityRole="link" onPress={() => Linking.openURL(s.uri)}>
          {s.title}
        </Text>
      ))}
    </View>
  );
}

function parseBbox(value: string | undefined): Bbox | null {
  const parts = value?.split(',').map(Number);
  return parts?.length === 4 && parts.every(Number.isFinite) ? (parts as Bbox) : null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.light.backgroundElement },
  back: { position: 'absolute', left: Spacing.four },
  backGlass: { width: MinTouch, alignItems: 'center', justifyContent: 'center' },
  sheetHeader: { gap: Spacing.three, paddingBottom: Spacing.three },
  titleRow: { paddingHorizontal: Spacing.five, gap: 2 },
  title: { ...Type.title2, color: Colors.light.text },
  count: { ...Type.subhead, color: Colors.light.textSecondary },
  chips: { gap: Spacing.two, paddingHorizontal: Spacing.five },
  listContent: { padding: Spacing.two, paddingBottom: Spacing.eight },
  status: { padding: Spacing.four, gap: Spacing.two, alignItems: 'flex-start' },
  emptyTitle: { ...Type.headline, color: Colors.light.text },
  hint: { ...Type.callout, color: Colors.light.textSecondary },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
  footer: { gap: Spacing.three, paddingTop: Spacing.three },
  attribution: { paddingHorizontal: Spacing.three, gap: Spacing.one },
  attributionText: { ...Type.footnote, color: Colors.light.textSecondary },
  link: { ...Type.footnote, color: Colors.light.primary },
});
