import type { RegionSearchGroup, RegionSearchResult } from '@rong/shared-types';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { RegionResult, RegionResultGroup } from '@/components/ui/region-result';
import { SearchField } from '@/components/ui/search-field';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useRegionSearch } from '@/hooks/use-region-search';

/** Thứ tự nhóm cố định theo FR-1.4, không theo điểm khớp. */
const GROUPS: { key: RegionSearchGroup; title: string }[] = [
  { key: 'province', title: 'Tỉnh, thành phố' },
  { key: 'destination', title: 'Điểm đến du lịch' },
  { key: 'ward', title: 'Xã, phường' },
];

export default function SearchScreen() {
  const [text, setText] = useState('');
  const search = useRegionSearch(text);

  const sections = GROUPS.map((g) => ({
    title: g.title,
    data: search.results.filter((r) => r.group === g.key),
  })).filter((s) => s.data.length > 0);

  const open = (region: RegionSearchResult) =>
    router.push({ pathname: '/region/[id]', params: { id: region.id, name: region.displayName } });

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <SearchField
          value={text}
          onChangeText={setText}
          onSubmitEditing={search.submit}
          autoFocus
          trailing={<Button label="Hủy" variant="plain" size="sm" onPress={() => router.back()} />}
        />
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RegionResult region={item} onPress={() => open(item)} />}
        renderSectionHeader={({ section }) => <RegionResultGroup title={section.title} />}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        ListFooterComponent={<SearchStatus search={search} />}
      />
    </SafeAreaView>
  );
}

function SearchStatus({ search }: { search: ReturnType<typeof useRegionSearch> }) {
  const { status, results, searchedOnline, error, query, submit, retry } = search;
  const empty = results.length === 0;

  if (status === 'error' && error) {
    return (
      <View style={styles.status}>
        <Notice tone="danger" title="Chưa tìm được" action={<Button label="Thử lại" variant="plain" size="sm" onPress={retry} style={styles.inlineAction} />}>
          {error.message}
        </Notice>
      </View>
    );
  }

  if (status === 'idle') {
    return <Text style={[styles.hint, styles.status]}>Gõ không dấu cũng được, ví dụ “da lat” hoặc “vung tau”.</Text>;
  }

  if (status === 'loading' && empty) {
    return <ActivityIndicator style={styles.status} color={Colors.light.primary} accessibilityLabel="Đang tìm" />;
  }

  if (status !== 'done') return null;

  if (empty && searchedOnline) {
    return (
      <View style={styles.status}>
        <Text style={styles.emptyTitle}>Không tìm thấy “{query}”</Text>
        <Text style={styles.hint}>Thử tên tỉnh, thành phố, hoặc một địa danh ở gần đó.</Text>
      </View>
    );
  }

  // Danh mục chưa có hoặc chưa đủ: mời tra thêm OpenStreetMap, việc này chỉ chạy khi người dùng chủ động bấm.
  if (!searchedOnline) {
    return (
      <View style={styles.status}>
        {empty ? <Text style={styles.emptyTitle}>Chưa có “{query}” trong danh mục</Text> : null}
        <Text style={styles.hint}>{empty ? 'Có thể nơi này chưa được thêm vào Rong.' : 'Không thấy nơi bạn cần?'}</Text>
        <Button label="Tìm thêm trên OpenStreetMap" variant="plain" size="sm" onPress={submit} style={styles.inlineAction} />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.three },
  list: { paddingHorizontal: Spacing.one, paddingBottom: Spacing.twelve },
  status: { paddingHorizontal: Spacing.three, paddingTop: Spacing.six, gap: Spacing.one },
  emptyTitle: { ...Type.headline, color: Colors.light.text },
  hint: { ...Type.callout, color: Colors.light.textSecondary },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
});
