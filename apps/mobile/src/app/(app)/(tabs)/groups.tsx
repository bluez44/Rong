import type { GroupRole, GroupSummary } from '@rong/shared-types';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { CreateGroupSheet } from '@/components/create-group-sheet';
import { useTabBarInset } from '@/components/floating-tab-bar';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { ROLE_LABELS } from '@/constants/groups';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { useGroups } from '@/hooks/use-groups';

/** Màu dải trên thẻ nhóm theo vai trò của mình. */
const BAND_COLORS: Record<GroupRole, string> = {
  owner: Palette.forest900,
  editor: Palette.forest700,
  viewer: Palette.charcoalMuted,
};

/** Tab "Nhóm" (F10): nhóm của tôi và nút tạo nhóm. */
export default function GroupsScreen() {
  const tabBarInset = useTabBarInset();
  const groups = useGroups();
  const { reload } = groups;
  const [creating, setCreating] = useState(false);

  // Tải lại khi quay về tab (vừa tạo, rời hay xoá nhóm), trừ lần đầu vì hook đã tự tải.
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) reload();
      focused.current = true;
    }, [reload]),
  );

  return (
    <Screen edges={['top']}>
      <FlatList
        data={groups.data ?? []}
        keyExtractor={(group) => group.id}
        renderItem={({ item }) => <GroupCard group={item} />}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarInset }]}
        ItemSeparatorComponent={() => <View style={styles.listGap} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headingRow}>
              <View style={styles.headingCopy}>
                <Text style={styles.title} accessibilityRole="header">Nhóm</Text>
                <Text style={styles.subtitle}>Cùng bạn bè lên lịch trình</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tạo nhóm"
                onPress={() => setCreating(true)}
                style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}>
                <Icon name="add" size={17} color={Palette.onPine} />
                <Text style={styles.createButtonText}>Tạo nhóm</Text>
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={<GroupsEmptyState groups={groups} onCreate={() => setCreating(true)} />}
        refreshControl={
          <RefreshControl refreshing={groups.status === 'refreshing'} onRefresh={reload} tintColor={Palette.forest700} />
        }
      />
      <CreateGroupSheet visible={creating} onClose={() => setCreating(false)} />
    </Screen>
  );
}

function GroupCard({ group }: { group: GroupSummary }) {
  const meta = `${group.memberCount} thành viên · ${group.itineraryCount > 0 ? `${group.itineraryCount} lịch trình` : 'chưa có lịch trình'}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group.name}, ${ROLE_LABELS[group.myRole]}, ${meta}`}
      onPress={() => router.push({ pathname: '/group/[id]', params: { id: group.id } })}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={[styles.band, { backgroundColor: BAND_COLORS[group.myRole] }]}>
        <View style={[styles.bandDot, group.myRole === 'viewer' && styles.bandDotMuted]} />
        <Text style={styles.bandText}>{ROLE_LABELS[group.myRole].toLocaleUpperCase('vi-VN')}</Text>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardText}>
          <Text style={styles.groupName} numberOfLines={2}>{group.name}</Text>
          <Text style={styles.groupMeta}>{meta}</Text>
        </View>
        <Icon name="forward" size={17} color={Palette.charcoalMuted} />
      </View>
    </Pressable>
  );
}

function GroupsEmptyState({ groups, onCreate }: { groups: ReturnType<typeof useGroups>; onCreate: () => void }) {
  if (groups.status === 'loading') return <ActivityIndicator color={Palette.forest700} style={styles.loading} />;
  if (groups.status === 'error' && groups.error) {
    return (
      <Notice
        tone="danger"
        title="Chưa tải được nhóm"
        action={<Button label="Thử lại" variant="plain" size="sm" onPress={groups.reload} style={styles.inlineAction} />}>
        {groups.error.message}
      </Notice>
    );
  }
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name="group" size={28} color={Palette.forest900} />
      </View>
      <Text style={styles.emptyTitle}>Chưa có nhóm nào</Text>
      <Text style={styles.emptyHint}>
        Tạo nhóm rồi gửi link mời qua Zalo, Messenger để cả hội cùng xem lịch trình.
      </Text>
      <Button label="Tạo nhóm đầu tiên" onPress={onCreate} style={styles.emptyAction} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.five },
  header: { gap: Spacing.four, marginBottom: Spacing.four },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  headingCopy: { flex: 1, gap: Spacing.one },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 29, lineHeight: 37, color: Palette.forest900 },
  subtitle: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: Palette.charcoalMuted },
  createButton: {
    minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one,
    paddingHorizontal: Spacing.three, borderRadius: Radius.pill, backgroundColor: Palette.forest900,
  },
  createButtonText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: Palette.onPine },
  listGap: { height: Spacing.three },
  card: {
    overflow: 'hidden', borderRadius: Radius.lg, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: Palette.parchment200,
  },
  band: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three },
  bandDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Palette.turmeric500 },
  bandDotMuted: { backgroundColor: Palette.parchment300 },
  bandText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, letterSpacing: 0.7, color: Palette.onPine },
  cardBody: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  cardText: { flex: 1, gap: 2 },
  groupName: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, lineHeight: 25, color: Palette.charcoal },
  groupMeta: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: Palette.charcoalMuted },
  loading: { paddingVertical: Spacing.six },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
  empty: {
    alignItems: 'center', gap: Spacing.two, marginTop: Spacing.four, padding: Spacing.five,
    borderRadius: Radius.lg, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: Palette.parchment200,
  },
  emptyIcon: {
    width: 64, height: 64, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.lg, backgroundColor: Palette.forest100, marginBottom: Spacing.one,
  },
  emptyTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: Palette.forest900 },
  emptyHint: {
    fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, lineHeight: 18, color: Palette.charcoalMuted, textAlign: 'center',
  },
  emptyAction: { marginTop: Spacing.two, alignSelf: 'stretch' },
  pressed: { opacity: 0.76 },
});
