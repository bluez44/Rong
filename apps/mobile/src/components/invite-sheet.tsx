import type { CreatedGroupInvite, InviteRole } from '@rong/shared-types';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { ROLE_LABELS } from '@/constants/groups';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { inviteUrl } from '@/lib/invite-link';

const ROLES: InviteRole[] = ['viewer', 'editor'];

/**
 * "Mời bạn bè" (FR-10.2, 10.4): chọn quyền, tạo link mời rồi mở bảng chia sẻ của hệ điều hành (Zalo, Messenger,
 * sao chép). Chỉ chủ nhóm mở được sheet này. Token chỉ trả về một lần nên đổi quyền là tạo link mới.
 */
export function InviteSheet({
  groupId,
  groupName,
  visible,
  onClose,
}: {
  groupId: string;
  groupName: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { authFetch, session } = useAuth();
  const [role, setRole] = useState<InviteRole>('viewer');
  const [link, setLink] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const share = async (url: string) => {
    const inviter = session?.user.displayName?.trim() || 'Mình';
    try {
      await Share.share({ message: `${inviter} mời bạn vào nhóm "${groupName}" trên Rong: ${url}` });
    } catch {
      // Người dùng đóng bảng chia sẻ: link vẫn hiện trong sheet để sao chép.
    }
  };

  const createAndShare = async () => {
    setCreating(true);
    setError(null);
    try {
      const invite = await authFetch<CreatedGroupInvite>(`/groups/${groupId}/invites`, {
        method: 'POST',
        body: { role },
      });
      const url = inviteUrl(invite.token);
      setLink(url);
      await share(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chưa tạo được link mời. Thử lại sau.');
    } finally {
      setCreating(false);
    }
  };

  const pickRole = (next: InviteRole) => {
    if (next === role) return;
    setRole(next);
    setLink(null);
  };

  const close = () => {
    setLink(null);
    setError(null);
    setRole('viewer');
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      header={
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Mời bạn bè</Text>
          <Text style={styles.hint}>Người được mời có quyền</Text>
        </View>
      }>
      <View style={styles.body}>
        <View style={styles.segment} accessibilityRole="radiogroup">
          {ROLES.map((option) => {
            const selected = option === role;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => pickRole(option)}
                style={[styles.segmentItem, selected && styles.segmentItemOn]}>
                <Text numberOfLines={1} style={[styles.segmentText, selected && styles.segmentTextOn]}>{ROLE_LABELS[option]}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.roleHint}>
          {role === 'viewer' ? 'Xem nhóm và lịch trình, không sửa được.' : 'Xem và sửa lịch trình của nhóm.'}
        </Text>

        {error ? <Notice tone="danger">{error}</Notice> : null}

        {link ? (
          <View style={styles.linkBox}>
            <Icon name="link" size={16} color={Palette.forest700} />
            <Text style={styles.linkText} selectable numberOfLines={2}>
              {link}
            </Text>
          </View>
        ) : null}
        <Text style={styles.expiry}>Link hết hạn sau 7 ngày.</Text>

        <Button
          label={link ? 'Chia sẻ lại' : 'Tạo link và chia sẻ'}
          onPress={link ? () => share(link) : createAndShare}
          loading={creating}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.one },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, lineHeight: 30, color: Palette.forest900 },
  hint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: Palette.charcoalMuted },
  body: { gap: Spacing.three, paddingTop: Spacing.two },
  segment: { flexDirection: 'row', padding: 3, borderRadius: Radius.pill, backgroundColor: Palette.parchment200 },
  segmentItem: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.pill },
  segmentItemOn: { backgroundColor: Palette.forest900 },
  segmentText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: Palette.charcoalMuted },
  segmentTextOn: { color: Palette.onPine },
  roleHint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: Palette.charcoalMuted },
  linkBox: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    padding: Spacing.three, borderRadius: Radius.md, backgroundColor: Palette.parchment100,
  },
  linkText: { flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: Palette.forest700 },
  expiry: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: Palette.charcoalMuted },
});
