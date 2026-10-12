import type { GooglePlacePreview, PlaceCategory, SaveGooglePlaceRequest, SaveGooglePlaceResponse } from '@rong/shared-types';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { TextField } from '@/components/ui/text-field';
import { CATEGORIES, CATEGORY_LABELS } from '@/constants/places';
import { Colors, Spacing, Type } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { useSavedPlaces } from '@/lib/saved-places';

type Props = {
  visible: boolean;
  onClose: () => void;
  preview: GooglePlacePreview;
  regionId: string;
  regionName?: string;
  /** Tên người dùng đã gõ khi tìm; dùng làm tên ban đầu (không lấy tên Google — tên Google chỉ là gợi ý). */
  initialName?: string;
};

/** Lưu địa điểm Google vào Rong và vào "Muốn đi": chọn tên và loại rồi lưu. */
export function SaveGooglePlaceSheet({ visible, onClose, preview, regionId, regionName, initialName }: Props) {
  const { authFetch } = useAuth();
  const saved = useSavedPlaces();
  const [name, setName] = useState(initialName?.trim() || '');
  const [category, setCategory] = useState<PlaceCategory>(preview.suggestedCategory);
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const googleName = preview.name;

  const save = async () => {
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const body: SaveGooglePlaceRequest = { googlePlaceId: preview.googlePlaceId, name: trimmed, category, regionId };
      const result = await authFetch<SaveGooglePlaceResponse>('/places/google', { method: 'POST', body });
      saved.reload();
      onClose();
      router.replace({ pathname: '/place/[id]', params: { id: result.placeId, regionId, regionName } });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Có lỗi không mong muốn. Thử lại sau.';
      Alert.alert('Chưa lưu được', message);
      setSaving(false);
    }
  };

  return (
    <ActionSheet visible={visible} title="Lưu vào Muốn đi" onClose={onClose}>
      <View style={styles.form}>
        <View style={styles.field}>
          <TextField label="Tên" value={name} onChangeText={setName} maxLength={120} returnKeyType="done" />
          {googleName && googleName !== trimmed ? <Text style={styles.hint}>Tên trên Google: {googleName}</Text> : null}
        </View>
        <View style={styles.chips}>
          {CATEGORIES.map((c) => (
            <Chip key={c} label={CATEGORY_LABELS[c]} selected={c === category} onPress={() => setCategory(c)} />
          ))}
        </View>
        <Button label="Lưu" size="lg" disabled={!trimmed || saving} loading={saving} onPress={save} />
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.four, paddingTop: Spacing.two },
  field: { gap: Spacing.one },
  hint: { ...Type.footnote, color: Colors.light.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
