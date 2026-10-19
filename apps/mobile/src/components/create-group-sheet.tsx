import type { GroupDetail } from '@rong/shared-types';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Palette, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api';

/** Tạo nhóm chỉ cần tên (backend: 1–60 ký tự). Tạo xong mở màn chi tiết nhóm. */
export function CreateGroupSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { authFetch } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setName('');
    setError(null);
    onClose();
  };

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const group = await authFetch<GroupDetail>('/groups', { method: 'POST', body: { name: name.trim() } });
      close();
      router.push({ pathname: '/group/[id]', params: { id: group.id } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chưa tạo được nhóm. Thử lại sau.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      header={
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Tạo nhóm</Text>
          <Text style={styles.hint}>Đặt tên để bạn bè nhận ra chuyến đi chung.</Text>
        </View>
      }>
      <View style={styles.body}>
        <TextField
          label="Tên nhóm"
          placeholder="Ví dụ: Đà Lạt cuối tuần"
          value={name}
          onChangeText={setName}
          maxLength={60}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => name.trim() && !saving && create()}
          error={error}
        />
        <Button label="Tạo nhóm" onPress={create} loading={saving} disabled={!name.trim()} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.one },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, lineHeight: 30, color: Palette.forest900 },
  hint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: Palette.charcoalMuted },
  body: { gap: Spacing.four, paddingTop: Spacing.three },
});
