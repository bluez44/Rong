import type { GroupDetail, InvitePreview } from '@rong/shared-types';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { initials, ROLE_LABELS } from '@/constants/groups';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api';

type State =
  | { status: 'loading' }
  | { status: 'ready'; preview: InvitePreview }
  | { status: 'error'; message: string };

/** Chấp nhận lời mời nhóm (F10). Mở từ link mời, sau khi người dùng đã đăng nhập. */
export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { authFetch } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authFetch<InvitePreview>(`/invites/${encodeURIComponent(token)}`)
      .then((preview) => !cancelled && setState({ status: 'ready', preview }))
      .catch((e) => !cancelled && setState({ status: 'error', message: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, [authFetch, token]);

  const join = async () => {
    setJoining(true);
    try {
      // Đã là thành viên thì backend vẫn trả nhóm (chỉ nâng quyền, không hạ): cũng vào thẳng nhóm.
      const group = await authFetch<GroupDetail>(`/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' });
      router.replace({ pathname: '/group/[id]', params: { id: group.id } });
    } catch (e) {
      setState({ status: 'error', message: messageOf(e) });
      setJoining(false);
    }
  };

  return (
    <Screen style={styles.screen} contentStyle={styles.content}>
      {state.status === 'loading' ? <ActivityIndicator color={Palette.forest700} /> : null}

      {state.status === 'error' ? (
        <View style={styles.block}>
          <Notice tone="danger" title="Không vào được nhóm">
            {state.message}
          </Notice>
          <Button label="Về trang chủ" variant="plain" onPress={() => router.replace('/')} />
        </View>
      ) : null}

      {state.status === 'ready' ? (
        <View style={styles.block}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{initials(state.preview.groupName)}</Text>
          </View>
          <View style={styles.copy}>
            <Text style={styles.inviter}>
              {state.preview.inviterName ? (
                <>
                  <Text style={styles.inviterName}>{state.preview.inviterName}</Text> mời bạn vào nhóm
                </>
              ) : (
                'Bạn được mời vào nhóm'
              )}
            </Text>
            <Text style={styles.groupName} accessibilityRole="header">{state.preview.groupName}</Text>
            <Text style={styles.meta}>
              {state.preview.memberCount} thành viên · bạn sẽ có quyền{' '}
              <Text style={styles.role}>{ROLE_LABELS[state.preview.role]}</Text>
            </Text>
          </View>
          <View style={styles.actions}>
            <Button label="Tham gia nhóm" size="lg" onPress={join} loading={joining} />
            <Button label="Để sau" variant="plain" onPress={() => router.replace('/groups')} disabled={joining} />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Có lỗi không mong muốn. Thử lại sau.';
}

const styles = StyleSheet.create({
  screen: { backgroundColor: Palette.parchment50 },
  content: { flex: 1, justifyContent: 'center', padding: Spacing.five },
  block: { gap: Spacing.four },
  badge: {
    alignSelf: 'center', width: 76, height: 76, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.lg, backgroundColor: Palette.forest100,
  },
  badgeText: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, color: Palette.forest900 },
  copy: { alignItems: 'center', gap: Spacing.one },
  inviter: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: Palette.charcoalMuted, textAlign: 'center' },
  inviterName: { fontFamily: 'PlusJakartaSans_700Bold', color: Palette.charcoal },
  groupName: {
    fontFamily: 'PlayfairDisplay_700Bold', fontSize: 28, lineHeight: 36, color: Palette.forest900, textAlign: 'center',
  },
  meta: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: Palette.charcoalMuted, textAlign: 'center' },
  role: { fontFamily: 'PlusJakartaSans_700Bold', color: Palette.terracotta700 },
  actions: { gap: Spacing.two, marginTop: Spacing.four },
});
