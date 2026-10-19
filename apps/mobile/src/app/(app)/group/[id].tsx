import type { GroupDetail, GroupMember, InviteRole } from '@rong/shared-types';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-context';
import { AddItinerarySheet } from '@/components/add-itinerary-sheet';
import { Glass } from '@/components/glass';
import { InviteSheet } from '@/components/invite-sheet';
import { Screen } from '@/components/screen';
import { TripCard } from '@/components/trip-card';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { TextField } from '@/components/ui/text-field';
import { initials, MY_ROLE_LINES, ROLE_LABELS } from '@/constants/groups';
import { MinTouch, Palette, Radius, Spacing } from '@/constants/theme';
import { useGroup } from '@/hooks/use-groups';
import { ApiError } from '@/lib/api';

const CREATED = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Chi tiết nhóm (F10): lịch trình của nhóm, thành viên, mời bạn bè. Màn đẩy lên, che thanh tab. */
export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const group = useGroup(id);
  const insets = useSafeAreaInsets();

  if (!group.data) {
    return (
      <Screen>
        <BackButton />
        <View style={styles.state}>
          {group.status === 'error' && group.error ? (
            <Notice
              tone="danger"
              title={group.error.status === 404 ? 'Không tìm thấy nhóm này' : 'Chưa tải được nhóm'}
              action={
                group.error.status === 404 ? (
                  <Button label="Về danh sách nhóm" variant="plain" size="sm" onPress={() => router.replace('/groups')} />
                ) : (
                  <Button label="Thử lại" variant="plain" size="sm" onPress={group.reload} />
                )
              }>
              {group.error.status === 404 ? 'Nhóm đã bị xoá, hoặc bạn không còn là thành viên.' : group.error.message}
            </Notice>
          ) : (
            <ActivityIndicator color={Palette.forest700} />
          )}
        </View>
      </Screen>
    );
  }

  return <GroupBody group={group.data} reload={group.reload} bottomInset={insets.bottom} />;
}

function GroupBody({ group, reload, bottomInset }: { group: GroupDetail; reload: () => void; bottomInset: number }) {
  const { authFetch, session } = useAuth();
  const myId = session?.user.id;
  const isOwner = group.myRole === 'owner';
  const [inviting, setInviting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [member, setMember] = useState<GroupMember | null>(null);

  /** Gọi API rồi tải lại nhóm; lỗi thì báo bằng message của backend. */
  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    try {
      await action();
      if (after) after();
      else reload();
    } catch (e) {
      Alert.alert('Chưa làm được', e instanceof ApiError ? e.message : 'Có lỗi không mong muốn. Thử lại sau.');
    }
  };

  const backToGroups = () => router.replace('/groups');

  const confirm = (title: string, message: string, label: string, action: () => void) =>
    Alert.alert(title, message, [
      { text: 'Huỷ', style: 'cancel' },
      { text: label, style: 'destructive', onPress: action },
    ]);

  const groupActions: SheetAction[] = isOwner
    ? [
        { label: 'Đổi tên nhóm', icon: 'edit', onPress: () => setRenaming(true) },
        {
          label: 'Xoá nhóm',
          icon: 'trash',
          destructive: true,
          onPress: () =>
            confirm('Xoá nhóm này?', 'Lịch trình trong nhóm trở về lịch trình cá nhân của người tạo.', 'Xoá nhóm', () =>
              run(() => authFetch(`/groups/${group.id}`, { method: 'DELETE' }), backToGroups),
            ),
        },
      ]
    : [
        {
          label: 'Rời nhóm',
          icon: 'logout',
          destructive: true,
          onPress: () =>
            confirm('Rời nhóm này?', 'Bạn sẽ không xem được lịch trình của nhóm nữa.', 'Rời nhóm', () =>
              run(() => authFetch(`/groups/${group.id}/members/${myId}`, { method: 'DELETE' }), backToGroups),
            ),
        },
      ];

  const memberActions = (target: GroupMember): SheetAction[] => {
    const setRole = (role: InviteRole) => () =>
      run(() => authFetch(`/groups/${group.id}/members/${target.userId}`, { method: 'PATCH', body: { role } }));
    const name = target.displayName ?? 'người này';
    return [
      target.role === 'viewer'
        ? { label: 'Cho quyền chỉnh sửa', icon: 'edit', onPress: setRole('editor') }
        : { label: 'Chỉ cho xem', icon: 'person', onPress: setRole('viewer') },
      {
        label: 'Xoá khỏi nhóm',
        icon: 'trash',
        destructive: true,
        onPress: () =>
          confirm(`Xoá ${name} khỏi nhóm?`, 'Họ sẽ không xem được lịch trình của nhóm nữa.', 'Xoá', () =>
            run(() => authFetch(`/groups/${group.id}/members/${target.userId}`, { method: 'DELETE' })),
          ),
      },
    ];
  };

  const created = CREATED.format(new Date(group.createdAt));
  const inviteBarHeight = MinTouch + Spacing.four * 2;

  return (
    <Screen edges={['top']} style={styles.screen}>
      <View style={styles.topBar}>
        <BackButton />
        <Pressable accessibilityRole="button" accessibilityLabel="Tuỳ chọn nhóm" onPress={() => setMenu(true)}>
          <Glass shape="circle" interactive style={styles.circle}>
            <Icon name="more" color={Palette.charcoal} />
          </Glass>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomInset + Spacing.six + (isOwner ? inviteBarHeight : 0) },
        ]}>
        <View style={styles.heading}>
          <View style={styles.roleLine}>
            <View style={styles.roleDot} />
            <Text style={styles.roleText}>{MY_ROLE_LINES[group.myRole].toLocaleUpperCase('vi-VN')}</Text>
          </View>
          <Text style={styles.title} accessibilityRole="header">{group.name}</Text>
          <Text style={styles.meta}>Tạo ngày {created} · {group.members.length} thành viên</Text>
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle} accessibilityRole="header">Lịch trình</Text>
          {group.myRole !== 'viewer' ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Thêm lịch trình vào nhóm" onPress={() => setAdding(true)} hitSlop={8}>
              <Text style={styles.sectionAction}>+ Thêm</Text>
            </Pressable>
          ) : null}
        </View>
        {group.itineraries.length > 0 ? (
          <View style={styles.trips}>
            {group.itineraries.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </View>
        ) : (
          <View style={styles.noTrips}>
            <Text style={styles.noTripsText}>Chưa có lịch trình</Text>
          </View>
        )}

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle} accessibilityRole="header">Thành viên</Text>
          <Text style={styles.count}>{group.members.length}</Text>
        </View>
        <View style={styles.members}>
          {group.members.map((m, index) => {
            const me = m.userId === myId;
            const name = `${m.displayName ?? 'Người dùng'}${me ? ' (bạn)' : ''}`;
            const manageable = isOwner && !me && m.role !== 'owner';
            return (
              <View key={m.userId} style={[styles.memberRow, index > 0 && styles.memberDivider]}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(m.displayName)}</Text>
                </View>
                <Text style={styles.memberName} numberOfLines={1}>{name}</Text>
                <Text style={[styles.rolePill, ROLE_PILL[m.role]]}>{ROLE_LABELS[m.role]}</Text>
                {manageable ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Tuỳ chọn cho ${m.displayName ?? 'thành viên'}`}
                    onPress={() => setMember(m)}
                    hitSlop={8}
                    style={styles.memberMore}>
                    <Icon name="more" size={18} color={Palette.charcoalMuted} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>

        {!isOwner ? <Text style={styles.ownerOnly}>Chỉ chủ nhóm gửi được lời mời.</Text> : null}
      </ScrollView>

      {isOwner ? (
        <View style={[styles.inviteBar, { paddingBottom: bottomInset + Spacing.four }]}>
          <Button label="Mời bạn bè" size="lg" onPress={() => setInviting(true)} />
        </View>
      ) : null}

      <ActionSheet visible={menu} title={group.name} actions={groupActions} onClose={() => setMenu(false)} />
      <ActionSheet
        visible={member !== null}
        title={member?.displayName ?? 'Thành viên'}
        message={member ? `Đang có quyền ${ROLE_LABELS[member.role]}` : undefined}
        actions={member ? memberActions(member) : []}
        onClose={() => setMember(null)}
      />
      <RenameSheet
        visible={renaming}
        current={group.name}
        onClose={() => setRenaming(false)}
        onSave={(name) => authFetch(`/groups/${group.id}`, { method: 'PATCH', body: { name } }).then(reload)}
      />
      <AddItinerarySheet groupId={group.id} visible={adding} onClose={() => setAdding(false)} onAdded={reload} />
      {isOwner ? (
        <InviteSheet groupId={group.id} groupName={group.name} visible={inviting} onClose={() => setInviting(false)} />
      ) : null}
    </Screen>
  );
}

function BackButton() {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => router.back()}>
      <Glass shape="circle" interactive style={styles.circle}>
        <Icon name="back" color={Palette.charcoal} />
      </Glass>
    </Pressable>
  );
}

function RenameSheet({
  visible,
  current,
  onClose,
  onSave,
}: {
  visible: boolean;
  current: string;
  onClose: () => void;
  onSave: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  // Mỗi lần mở lại thì điền tên hiện tại.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setName(current);
      setError(null);
    }
  }

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim());
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chưa đổi được tên. Thử lại sau.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ActionSheet visible={visible} title="Đổi tên nhóm" onClose={onClose}>
      <View style={styles.renameBody}>
        <TextField label="Tên nhóm" value={name} onChangeText={setName} maxLength={60} error={error} />
        <Button label="Lưu" onPress={save} loading={saving} disabled={!name.trim() || name.trim() === current} />
      </View>
    </ActionSheet>
  );
}

const ROLE_PILL = StyleSheet.create({
  owner: { backgroundColor: Palette.forest900, color: Palette.onPine },
  editor: { backgroundColor: Palette.terracotta100, color: Palette.terracotta700 },
  viewer: { backgroundColor: Palette.parchment200, color: Palette.charcoalMuted },
});

const styles = StyleSheet.create({
  screen: { backgroundColor: Palette.parchment50 },
  state: { flex: 1, justifyContent: 'center', padding: Spacing.four },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.four, paddingVertical: Spacing.two,
  },
  circle: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: Spacing.four, gap: Spacing.three },
  heading: { gap: Spacing.one, marginBottom: Spacing.two },
  roleLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  roleDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Palette.turmeric500 },
  roleText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, letterSpacing: 0.7, color: Palette.terracotta700 },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 28, lineHeight: 36, color: Palette.forest900 },
  meta: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: Palette.charcoalMuted },
  sectionHeading: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: Spacing.three,
  },
  sectionTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: Palette.charcoal },
  sectionAction: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: Palette.forest700 },
  count: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: Palette.charcoalMuted },
  trips: { gap: Spacing.three },
  noTrips: {
    alignItems: 'center', padding: Spacing.four, borderRadius: Radius.lg,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: Palette.parchment300,
  },
  noTripsText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: Palette.charcoalMuted },
  members: {
    paddingHorizontal: Spacing.three, borderRadius: Radius.lg, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: Palette.parchment200,
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 56 },
  memberDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Palette.parchment300 },
  avatar: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Palette.forest100,
  },
  avatarText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: Palette.forest900 },
  memberName: { flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: Palette.charcoal },
  rolePill: {
    overflow: 'hidden', paddingHorizontal: Spacing.two, paddingVertical: 3, borderRadius: Radius.pill,
    fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10,
  },
  memberMore: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  ownerOnly: {
    marginTop: Spacing.two, padding: Spacing.three, borderRadius: Radius.md, backgroundColor: Palette.parchment100,
    fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: Palette.charcoalMuted,
  },
  inviteBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: Spacing.four, paddingTop: Spacing.four, backgroundColor: Palette.parchment50,
  },
  renameBody: { gap: Spacing.three, paddingTop: Spacing.two },
});
