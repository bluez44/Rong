import type { PlaceCategory } from '@rong/shared-types';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Icon, type IconName } from '@/components/ui/icon';
import { TextField } from '@/components/ui/text-field';
import { CATEGORIES, CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { updatePreferences, usePreferences } from '@/lib/preferences';
import { useSavedPlaces } from '@/lib/saved-places';
import { formatFullDate } from '@/lib/trip-format';

const INTERESTS = CATEGORIES.filter((c) => c !== 'stay');

/** Tài khoản (F11): hồ sơ, sở thích, dữ liệu của bạn, đăng xuất và xóa tài khoản. */
export default function AccountScreen() {
  const { session, signOut } = useAuth();
  const user = session?.user;
  const name = user?.displayName ?? user?.email ?? 'Bạn';
  const initial = name.trim().charAt(0).toUpperCase();

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.title} accessibilityRole="header">
          Tài khoản
        </Text>

        <View style={styles.card}>
          <View style={styles.avatar} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Text style={styles.initial}>{initial}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            {user?.email ? (
              <Text style={styles.meta} numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
            {user?.createdAt ? <Text style={styles.meta}>Tham gia từ {formatFullDate(user.createdAt)}</Text> : null}
          </View>
        </View>

        <DisplayNameForm current={user?.displayName ?? ''} />
        <Interests />
        <YourData />

        <View style={styles.group}>
          <Row icon="map" label="Xem lại phần giới thiệu" onPress={() => updatePreferences({ onboarded: false })} />
        </View>

        <Button label="Đăng xuất" variant="glass" onPress={signOut} />
        <DeleteAccount />
      </ScrollView>
    </Screen>
  );
}

function DisplayNameForm({ current }: { current: string }) {
  const { updateDisplayName } = useAuth();
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const trimmed = value.trim();
  const changed = trimmed !== current;

  const save = async () => {
    if (!trimmed) {
      setError('Nhập tên hiển thị.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateDisplayName(trimmed);
      setValue(trimmed);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chưa lưu được. Thử lại sau.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.section}>
      <TextField
        label="Tên hiển thị"
        value={value}
        onChangeText={(text) => {
          setValue(text);
          setSaved(false);
        }}
        maxLength={50}
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={changed ? save : undefined}
        error={error}
        hint={saved && !changed ? 'Đã lưu.' : 'Tên hiển thị trong app thay cho email.'}
      />
      {changed ? <Button label="Lưu tên" size="sm" loading={saving} onPress={save} style={styles.inlineButton} /> : null}
    </View>
  );
}

/** Sở thích dùng để điền sẵn khi tạo lịch trình; lưu trên máy này. */
function Interests() {
  const preferences = usePreferences();
  const selected = preferences?.interests ?? [];
  const toggle = (c: PlaceCategory) =>
    updatePreferences({ interests: selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c] });

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        Sở thích
      </Text>
      <Text style={styles.meta}>Điền sẵn khi bạn tạo lịch trình, để AI ưu tiên. Chỉ lưu trên máy này.</Text>
      <View style={styles.chips}>
        {INTERESTS.map((c) => (
          <Chip key={c} label={CATEGORY_LABELS[c]} icon={c} selected={selected.includes(c)} onPress={() => toggle(c)} />
        ))}
      </View>
    </View>
  );
}

function YourData() {
  const saved = useSavedPlaces();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        Dữ liệu của bạn
      </Text>
      <View style={styles.group}>
        <Row
          icon="heart"
          label="Muốn đi"
          detail={saved.status === 'loading' ? undefined : `${saved.items.length} địa điểm`}
          onPress={() => router.push('/saved')}
        />
        <View style={styles.divider} />
        <Row icon="calendar" label="Chuyến đi" onPress={() => router.navigate('/trips')} />
      </View>
    </View>
  );
}

function Row({ icon, label, detail, onPress }: { icon: IconName; label: string; detail?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Icon name={icon} size={20} color={Colors.light.primary} />
      <Text style={[styles.rowLabel, styles.flex]}>{label}</Text>
      {detail ? <Text style={styles.meta}>{detail}</Text> : null}
      <Icon name="forward" size={16} />
    </Pressable>
  );
}

/** Xóa tài khoản và toàn bộ dữ liệu ngay trong app (F11). Không hoàn tác được. */
function DeleteAccount() {
  const { deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      // Thành công thì phiên bị xóa và app tự về màn đăng nhập.
      await deleteAccount();
    } catch (e) {
      setDeleting(false);
      Alert.alert('Chưa xóa được tài khoản', e instanceof ApiError ? e.message : 'Thử lại sau.');
    }
  };

  const confirm = () =>
    Alert.alert(
      'Xóa tài khoản?',
      'Tài khoản, mọi lịch trình và danh sách "Muốn đi" sẽ bị xóa vĩnh viễn. Không thể hoàn tác.',
      [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Xóa vĩnh viễn', style: 'destructive', onPress: remove },
      ],
    );

  return (
    <View style={styles.danger}>
      <Button label="Xóa tài khoản" variant="danger" loading={deleting} onPress={confirm} />
      <Text style={styles.dangerHint}>Xóa hẳn tài khoản cùng mọi lịch trình và địa điểm đã lưu.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.six, paddingBottom: Spacing.eight, gap: Spacing.six },
  title: { ...Type.title1, color: Colors.light.text },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.backgroundSelected,
  },
  initial: { ...Type.title2, color: Colors.light.primary },
  name: { ...Type.headline, color: Colors.light.text },
  meta: { ...Type.subhead, color: Colors.light.textSecondary },
  section: { gap: Spacing.two },
  sectionTitle: { ...Type.headline, color: Colors.light.text },
  inlineButton: { alignSelf: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.one },
  group: { borderRadius: Radius.md, borderCurve: 'continuous', backgroundColor: Colors.light.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: MinTouch + 8, paddingHorizontal: Spacing.four },
  rowLabel: { ...Type.body, color: Colors.light.text },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.light.hairline, marginLeft: Spacing.four + 20 + Spacing.three },
  pressed: { backgroundColor: Colors.light.backgroundSelected },
  danger: { gap: Spacing.two, alignItems: 'center', paddingTop: Spacing.four },
  dangerHint: { ...Type.footnote, color: Colors.light.textSecondary, textAlign: 'center' },
});
