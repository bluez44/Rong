import type { SavedPlace, ShareImportSummary } from '@rong/shared-types';
import { router } from 'expo-router';
import { ActivityIndicator, Linking, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '@/components/glass';
import { Screen } from '@/components/screen';
import { PLATFORM_LABELS } from '@/components/share-source-card';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';
import { useShareImports } from '@/hooks/use-share-imports';
import { useSavedPlaces } from '@/lib/saved-places';
import { notesSummary } from '@/lib/place-notes';
import { planFromSaved } from '@/lib/plan-from-saved';
import { MAX_SELECTED_PLACES } from '@/lib/trip-draft';

type Group = { regionId: string; regionName: string; data: SavedPlace[] };

/** Danh sách "Muốn đi" (F9), nhóm theo điểm đến; mỗi nhóm mở được luồng tạo lịch trình (F6). */
export default function SavedScreen() {
  const saved = useSavedPlaces();
  const shares = useShareImports();
  const insets = useSafeAreaInsets();
  const groups = groupByRegion(saved.items);
  const refresh = () => {
    saved.reload();
    shares.reload();
  };

  return (
    // Chỉ chừa cạnh trên: danh sách cuộn xuống dưới thanh home.
    <Screen edges={['top']}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => router.back()}>
          <Glass shape="circle" interactive style={styles.backGlass}>
            <Icon name="back" color={Colors.light.text} />
          </Glass>
        </Pressable>
      </View>
      <SectionList
        sections={groups}
        keyExtractor={(item) => item.placeId}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.eight }]}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Text style={styles.title} accessibilityRole="header">
              Muốn đi
            </Text>
            {shares.items.length > 0 ? <PendingShares items={shares.items} /> : null}
          </View>
        }
        renderSectionHeader={({ section }) => <GroupHeader group={section} />}
        renderItem={({ item }) => (
          <SavedRow
            item={item}
            onRemove={() =>
              saved.toggle({ id: item.placeId, name: item.name, category: item.category }, { id: item.regionId, name: item.regionName })
            }
          />
        )}
        ListEmptyComponent={<EmptyState saved={saved} />}
        refreshControl={
          <RefreshControl refreshing={saved.status === 'refreshing'} onRefresh={refresh} tintColor={Colors.light.primary} />
        }
      />
    </Screen>
  );
}

function GroupHeader({ group }: { group: Group }) {
  const places = group.data.filter((p) => p.category !== 'stay');
  const plan = () => planFromSaved(group);
  const overLimit = places.length > MAX_SELECTED_PLACES;

  return (
    <View style={styles.groupHeader}>
      <View style={styles.groupTitleRow}>
        <View style={styles.flex}>
          <Text style={styles.groupTitle} numberOfLines={1} accessibilityRole="header">
            {group.regionName}
          </Text>
          <Text style={styles.meta}>
            {group.data.length} địa điểm{overLimit ? ` · xếp ${MAX_SELECTED_PLACES} điểm lưu gần nhất` : ''}
          </Text>
        </View>
        <Button label="Xếp lịch giúp tôi" size="sm" onPress={plan} accessibilityLabel={`Xếp lịch giúp tôi ở ${group.regionName}`} />
      </View>
    </View>
  );
}

function PendingShares({ items }: { items: ShareImportSummary[] }) {
  return (
    <View style={styles.shares}>
      <Text style={styles.sharesTitle} accessibilityRole="header">
        Từ bài chia sẻ
      </Text>
      {items.map((s) => {
        const status = s.status === 'pending' ? 'Đang nhận diện…' : `${s.candidateCount} địa điểm chờ bạn chọn`;
        const title = s.source.title ?? 'Bài chia sẻ';
        return (
          <Pressable
            key={s.id}
            accessibilityRole="button"
            accessibilityLabel={`${PLATFORM_LABELS[s.source.platform]}, ${title}, ${status}`}
            onPress={() => router.push({ pathname: '/share-import/[id]', params: { id: s.id } })}
            style={({ pressed }) => [styles.shareRow, pressed && styles.pressed]}>
            <View style={styles.flex}>
              <Text style={styles.meta}>{PLATFORM_LABELS[s.source.platform]}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.meta}>{status}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function SavedRow({ item, onRemove }: { item: SavedPlace; onRemove: () => void }) {
  const openDetail = () =>
    router.push({
      pathname: '/place/[id]',
      params: {
        id: item.placeId,
        name: item.name,
        category: item.category,
        regionId: item.regionId,
        regionName: item.regionName,
        from: 'saved',
      },
    });

  const source = item.shareSource;
  const sourceUrl = source?.url ?? null;

  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.name}, ${CATEGORY_LABELS[item.category]}`}
          accessibilityHint="Mở chi tiết địa điểm"
          onPress={openDetail}
          style={({ pressed }) => [styles.rowMain, source && styles.rowMainWithSource, pressed && styles.pressed]}>
          <View style={styles.icon}>
            <Icon name={item.category} size={20} color={Colors.light.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[CATEGORY_LABELS[item.category], notesSummary(item.notes)].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </Pressable>
        {source ? (
          // Spec §6: chạm nhãn nguồn thì mở bài gốc; phần còn lại của dòng vẫn mở chi tiết.
          <Pressable
            accessibilityRole={sourceUrl ? 'link' : undefined}
            accessibilityLabel={`Từ ${PLATFORM_LABELS[source.platform]}`}
            accessibilityHint={sourceUrl ? 'Mở bài chia sẻ gốc' : undefined}
            disabled={!sourceUrl}
            onPress={sourceUrl ? () => Linking.openURL(sourceUrl) : undefined}
            hitSlop={{ top: 6, bottom: 6 }}
            style={({ pressed }) => [styles.sourceLabel, pressed && styles.pressed]}>
            <Text style={[styles.meta, sourceUrl && styles.link]}>Từ {PLATFORM_LABELS[source.platform]}</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Bỏ khỏi Muốn đi: ${item.name}`}
        onPress={onRemove}
        style={({ pressed }) => [styles.remove, pressed && styles.pressed]}>
        <Icon name="heartFill" color={Colors.light.danger} />
      </Pressable>
    </View>
  );
}

function EmptyState({ saved }: { saved: ReturnType<typeof useSavedPlaces> }) {
  if (saved.status === 'loading') return <ActivityIndicator color={Colors.light.primary} style={styles.loading} />;
  if (saved.status === 'error' && saved.error) {
    return (
      <Notice
        tone="danger"
        title="Chưa tải được danh sách"
        action={<Button label="Thử lại" variant="plain" size="sm" onPress={saved.reload} style={styles.inlineAction} />}>
        {saved.error.message}
      </Notice>
    );
  }
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>Chưa lưu địa điểm nào</Text>
      <Text style={styles.hint}>Thả tim những chỗ bạn muốn ghé khi xem một điểm đến. Chúng sẽ được gom ở đây theo từng nơi.</Text>
      <Text style={styles.hint}>Hoặc chia sẻ video, bài viết từ TikTok, Facebook… vào Rong.</Text>
      <Button label="Tìm điểm đến" onPress={() => router.push('/search')} style={styles.emptyAction} />
    </View>
  );
}

/** Nhóm theo vùng; nhóm có địa điểm lưu gần nhất lên đầu (danh sách đã sắp mới nhất trước). */
function groupByRegion(items: SavedPlace[]): Group[] {
  const groups = new Map<string, Group>();
  for (const item of items) {
    const group = groups.get(item.regionId);
    if (group) group.data.push(item);
    else groups.set(item.regionId, { regionId: item.regionId, regionName: item.regionName, data: [item] });
  }
  return [...groups.values()];
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  backGlass: { width: MinTouch, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: Spacing.four, gap: Spacing.two },
  headerBlock: { gap: Spacing.two },
  shares: { gap: Spacing.two, marginTop: Spacing.two },
  sharesTitle: { ...Type.headline, color: Colors.light.text },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
  },
  title: { ...Type.title1, color: Colors.light.text, marginBottom: Spacing.two },
  loading: { paddingVertical: Spacing.six },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
  empty: { gap: Spacing.two, paddingTop: Spacing.four, alignItems: 'flex-start' },
  emptyTitle: { ...Type.headline, color: Colors.light.text },
  hint: { ...Type.callout, color: Colors.light.textSecondary },
  emptyAction: { marginTop: Spacing.two },
  groupHeader: { paddingTop: Spacing.five, paddingBottom: Spacing.one },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  groupTitle: { ...Type.title2, color: Colors.light.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  rowMainWithSource: { paddingBottom: Spacing.one },
  // Thẳng cột với tên: lề trái = padding + ô biểu tượng 44 + khoảng cách.
  sourceLabel: {
    alignSelf: 'flex-start',
    marginLeft: Spacing.three + 44 + Spacing.three,
    paddingBottom: Spacing.three,
  },
  link: { color: Colors.light.primary },
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
  remove: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.one },
});
