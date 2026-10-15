import type { GooglePlaceHit, PlaceSearchHit } from '@rong/shared-types';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
// Bản của gesture-handler: nằm trong PlaceSheet nên phải phối hợp với cử chỉ kéo sheet.
import { FlatList } from 'react-native-gesture-handler';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Spacing, Type } from '@/constants/theme';
import type { usePlaceSearch } from '@/hooks/use-place-search';

type Row =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'place'; key: string; place: PlaceSearchHit }
  | { kind: 'google'; key: string; hit: GooglePlaceHit }
  | { kind: 'footer'; key: string; text: string };

type Props = {
  search: ReturnType<typeof usePlaceSearch>;
  regionId: string;
  regionName: string;
  query: string;
};

/** Kết quả tìm theo tên: "Trong Rong" (danh mục + Google đã có trong DB) rồi "Từ Google Maps". */
export function PlaceSearchResults({ search, regionId, regionName, query }: Props) {
  const { status, catalog, existing, google, searchedOnline, error } = search;
  const q = query.trim();

  // Bỏ trùng id: một địa điểm có thể vừa khớp tên trong danh mục vừa là kết quả Google.
  const seen = new Set<string>();
  const inRong = [...catalog, ...existing].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  const rows: Row[] = [];
  if (inRong.length > 0) {
    rows.push({ kind: 'header', key: 'h-rong', title: 'Trong Rong' });
    for (const place of inRong) rows.push({ kind: 'place', key: `p-${place.id}`, place });
  }
  if (google !== null && google.length > 0) {
    rows.push({ kind: 'header', key: 'h-google', title: 'Từ Google Maps' });
    for (const hit of google) rows.push({ kind: 'google', key: `g-${hit.googlePlaceId}`, hit });
    rows.push({ kind: 'footer', key: 'f-google', text: 'Kết quả từ Google Maps' });
  }

  const loading = status === 'loading';
  // Đã hỏi Google nhưng Google không trả lời được (`google: null`): không phải "không tìm thấy".
  const googleUnavailable = searchedOnline && status === 'done' && google === null;
  const noResults = searchedOnline && status === 'done' && !googleUnavailable && inRong.length === 0 && (google?.length ?? 0) === 0;
  const showGoogleButton = !(searchedOnline && status === 'done') || googleUnavailable;

  const openPlace = (place: PlaceSearchHit) =>
    router.push({ pathname: '/place/[id]', params: { id: place.id, name: place.name, category: place.category, regionId, regionName } });
  const openGoogle = (hit: GooglePlaceHit) =>
    router.push({ pathname: '/place/google/[googlePlaceId]', params: { googlePlaceId: hit.googlePlaceId, regionId, regionName, q } });

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.key}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.content}
      renderItem={({ item }) => {
        switch (item.kind) {
          case 'header':
            return (
              <Text style={styles.groupTitle} accessibilityRole="header">
                {item.title}
              </Text>
            );
          case 'place':
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={[item.place.name, CATEGORY_LABELS[item.place.category], item.place.address].filter(Boolean).join(', ')}
                onPress={() => openPlace(item.place)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <Text style={styles.name} numberOfLines={2}>
                  {item.place.name}
                </Text>
                <Text style={styles.sub} numberOfLines={2}>
                  {[CATEGORY_LABELS[item.place.category], item.place.address].filter(Boolean).join(' · ')}
                </Text>
              </Pressable>
            );
          case 'google':
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={[item.hit.name ?? 'Không rõ tên', item.hit.address].filter(Boolean).join(', ')}
                onPress={() => openGoogle(item.hit)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <Text style={styles.name} numberOfLines={2}>
                  {item.hit.name ?? 'Không rõ tên'}
                </Text>
                <Text style={styles.sub} numberOfLines={2}>
                  {item.hit.address ?? CATEGORY_LABELS[item.hit.suggestedCategory]}
                </Text>
              </Pressable>
            );
          case 'footer':
            return <Text style={styles.attribution}>{item.text}</Text>;
        }
      }}
      ListFooterComponent={
        <View style={styles.status}>
          {error ? (
            <Notice
              tone="danger"
              title={error.code === 'PLACE_SEARCH_LIMIT' ? 'Hết lượt tìm trên Google Maps' : 'Chưa tìm được'}
              action={<Button label="Thử lại" variant="plain" size="sm" onPress={search.retry} style={styles.inlineAction} />}>
              {error.message}
            </Notice>
          ) : null}
          {googleUnavailable && !loading ? (
            <Notice
              tone="warning"
              title="Chưa tìm được trên Google Maps lúc này."
              action={<Button label="Thử lại" variant="plain" size="sm" onPress={search.submit} style={styles.inlineAction} />}
            />
          ) : null}
          {loading ? <ActivityIndicator color={Colors.light.primary} /> : null}
          {noResults ? <Text style={styles.hint}>{`Không tìm thấy “${q}” ở ${regionName}`}</Text> : null}
          {showGoogleButton && !loading ? (
            <Button
              label="Tìm trên Google Maps"
              variant={inRong.length === 0 ? 'primary' : 'plain'}
              onPress={search.submit}
              style={inRong.length === 0 ? undefined : styles.inlineAction}
            />
          ) : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.two, paddingBottom: Spacing.eight },
  groupTitle: { ...Type.subhead, color: Colors.light.textSecondary, paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.one },
  row: { minHeight: MinTouch, justifyContent: 'center', gap: 2, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  pressed: { backgroundColor: Colors.light.backgroundElement },
  name: { ...Type.headline, color: Colors.light.text },
  sub: { ...Type.footnote, color: Colors.light.textSecondary },
  attribution: { ...Type.footnote, color: Colors.light.textSecondary, paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  status: { padding: Spacing.three, gap: Spacing.three, alignItems: 'flex-start' },
  hint: { ...Type.callout, color: Colors.light.textSecondary },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
});
