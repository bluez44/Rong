import type { PlaceCategory } from '@rong/shared-types';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { useTabBarInset } from '@/components/floating-tab-bar';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Icon, type IconName } from '@/components/ui/icon';
import { TextField } from '@/components/ui/text-field';
import { CATEGORIES, CATEGORY_LABELS } from '@/constants/places';
import { Palette, Radius, Shadow, Spacing } from '@/constants/theme';
import { useItineraries } from '@/hooks/use-itineraries';
import { ApiError } from '@/lib/api';
import { updatePreferences, usePreferences } from '@/lib/preferences';
import { useSavedPlaces } from '@/lib/saved-places';
import { formatFullDate } from '@/lib/trip-format';

const INTERESTS = CATEGORIES.filter((category) => category !== 'stay');

/** Tài khoản (F11): hồ sơ, sở thích, dữ liệu của bạn, đăng xuất và xóa tài khoản. */
export default function AccountScreen() {
  const tabBarInset = useTabBarInset();
  const { session, signOut } = useAuth();
  const user = session?.user;
  const name = user?.displayName || 'Lữ khách Rong';
  const initial = name.trim().charAt(0).toUpperCase() || 'R';
  const trips = useItineraries();
  const saved = useSavedPlaces();
  const preferences = usePreferences();
  const [isScrolled, setIsScrolled] = useState(false);

  // Làm mới số liệu khi quay về tab sau khi tạo hoặc xóa lịch trình.
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) trips.reload();
      focused.current = true;
    }, [trips.reload]),
  );

  return (
    <Screen edges={['top']} style={styles.screen}>
      <View style={[styles.stickyHeader, isScrolled && styles.stickyHeaderScrolled]}>
        <View style={styles.headerCopy}>
          <Text style={styles.pageTitle} accessibilityRole="header">Tài khoản</Text>
        </View>
        <View style={styles.headerMark}>
          <Icon name="person" size={19} color={Palette.forest700} />
        </View>
      </View>
      <ScrollView
        style={styles.scrollView}
        scrollEventThrottle={16}
        onScroll={(event) => {
          const next = event.nativeEvent.contentOffset.y > Spacing.two;
          setIsScrolled((current) => (current === next ? current : next));
        }}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarInset }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <ProfileCard
          initial={initial}
          name={name}
          email={user?.email ?? ''}
          emailVerified={user?.emailVerified ?? false}
          createdAt={user?.createdAt}
          tripCount={trips.data?.length}
          savedCount={saved.status === 'done' || saved.status === 'refreshing' ? saved.items.length : undefined}
          interestCount={preferences?.interests.length ?? 0}
        />

        <DisplayNameForm current={user?.displayName ?? ''} />
        <Interests />
        <YourData
          savedCount={saved.status === 'done' || saved.status === 'refreshing' ? saved.items.length : undefined}
          savedError={saved.status === 'error'}
          tripCount={trips.data?.length}
          tripError={trips.status === 'error' && !trips.data}
        />

        <View style={styles.moreSection}>
          <Text style={styles.sectionEyebrow}>THÊM CHO HÀNH TRÌNH</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => updatePreferences({ onboarded: false })}
            style={({ pressed }) => [styles.utilityRow, pressed && styles.pressed]}>
            <View style={styles.utilityIcon}>
              <Icon name="map" size={18} color={Palette.forest700} />
            </View>
            <View style={styles.utilityCopy}>
              <Text style={styles.rowTitle}>Xem lại phần giới thiệu</Text>
              <Text style={styles.rowDetail}>Khám phá cách Rong đồng hành cùng bạn</Text>
            </View>
            <Icon name="forward" size={16} color={Palette.charcoalMuted} />
          </Pressable>
        </View>

        <View style={styles.accountActions}>
          <Button label="Đăng xuất tài khoản" variant="glass" onPress={signOut} />
          <DeleteAccount />
          <Text style={styles.brandFooter}>Rong Thong Dong · Dấu chân khắp Việt Nam</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

function ProfileCard({
  initial,
  name,
  email,
  emailVerified,
  createdAt,
  tripCount,
  savedCount,
  interestCount,
}: {
  initial: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt?: string;
  tripCount?: number;
  savedCount?: number;
  interestCount: number;
}) {
  return (
    <View style={styles.profileCard}>
      <View style={styles.profileDecoration} pointerEvents="none" />
      <View style={styles.profileTopline}>
        <Text style={styles.profileLabel}>RONG · THẺ LỮ KHÁCH</Text>
        <Icon name="explore" size={18} color={Palette.turmeric100} />
      </View>

      <View style={styles.profileMain}>
        <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>
        <View style={styles.profileIdentity}>
          <View style={styles.nameLine}>
            <Text style={styles.profileName} numberOfLines={1}>{name}</Text>
            {emailVerified ? (
              <View style={styles.verifiedBadge} accessibilityLabel="Email đã xác minh">
                <Icon name="check" size={11} color={Palette.forest900} />
              </View>
            ) : null}
          </View>
          {email ? <Text style={styles.profileEmail} numberOfLines={1}>{email}</Text> : null}
          {createdAt ? <Text style={styles.profileJoined}>Đồng hành từ {formatFullDate(createdAt)}</Text> : null}
        </View>
      </View>

      <View style={styles.profileDivider} />

      <View style={styles.statsRow}>
        <Stat value={tripCount === undefined ? '—' : String(tripCount)} label="Chuyến đi" />
        <View style={styles.statDivider} />
        <Stat value={savedCount === undefined ? '—' : String(savedCount)} label="Muốn đi" />
        <View style={styles.statDivider} />
        <Stat value={String(interestCount)} label="Sở thích" />
      </View>
      <Text style={styles.profileSlogan}>Rong Thong Dong</Text>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DisplayNameForm({ current }: { current: string }) {
  const { updateDisplayName } = useAuth();
  const [value, setValue] = useState(current);
  const [editing, setEditing] = useState(false);
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
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chưa lưu được. Thử lại sau.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.nameSection}>
      <View style={styles.sectionHeading}>
        <View style={styles.sectionHeadingCopy}>
          <Text style={styles.sectionEyebrow}>DANH XƯNG</Text>
          <Text style={styles.sectionTitle}>Tên hiển thị</Text>
        </View>
        {!editing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Chỉnh sửa tên hiển thị"
            onPress={() => setEditing(true)}
            style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
            <Icon name="edit" size={14} color={Palette.forest700} />
            <Text numberOfLines={1} style={styles.editButtonText}>Chỉnh sửa</Text>
          </Pressable>
        ) : null}
      </View>
      {editing ? (
        <View style={styles.editForm}>
          <TextField
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
            hint={saved && !changed ? 'Đã lưu.' : 'Tên này sẽ hiển thị thay cho email.'}
            label="Tên hiển thị"
          />
          <View style={styles.editActions}>
            <Button label="Hủy" variant="plain" size="sm" onPress={() => { setValue(current); setError(null); setEditing(false); }} />
            <Button label="Lưu tên" size="sm" loading={saving} disabled={!changed} onPress={save} />
          </View>
        </View>
      ) : (
        <View style={styles.displayNameCard}>
          <View style={styles.displayNameIcon}>
            <Icon name="person" size={17} color={Palette.forest700} />
          </View>
          <View style={styles.displayNameCopy}>
            <Text style={styles.displayNameValue} numberOfLines={1}>{current || 'Chưa đặt tên'}</Text>
            <Text style={styles.rowDetail}>Tên bạn bè thấy trong các chuyến đi chung</Text>
          </View>
          <Icon name="check" size={16} color={Palette.forest700} />
        </View>
      )}
    </View>
  );
}

/** Sở thích dùng để điền sẵn khi tạo lịch trình; lưu trên máy này. */
function Interests() {
  const preferences = usePreferences();
  const selected = preferences?.interests ?? [];
  const toggle = (category: PlaceCategory) =>
    updatePreferences({ interests: selected.includes(category) ? selected.filter((item) => item !== category) : [...selected, category] });

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <View style={styles.sectionHeadingCopy}>
          <Text style={styles.sectionEyebrow}>CÁ NHÂN HÓA</Text>
          <Text style={styles.sectionTitle} accessibilityRole="header">Sở thích du ngoạn</Text>
        </View>
        <View style={styles.aiPill}>
          <Icon name="sparkles" size={12} color={Palette.terracotta700} />
          <Text style={styles.aiPillText}>AI gợi ý</Text>
        </View>
      </View>
      <Text style={styles.sectionDescription}>Chọn điều bạn thích để Rong ưu tiên khi gợi ý điểm đến. Sở thích được lưu vào tài khoản để gợi ý lịch trình ở trang chủ.</Text>
      <View style={styles.chips}>
        {INTERESTS.map((category) => (
          <Chip
            key={category}
            label={CATEGORY_LABELS[category]}
            icon={category}
            selected={selected.includes(category)}
            onPress={() => toggle(category)}
          />
        ))}
      </View>
    </View>
  );
}

function YourData({
  savedCount,
  savedError,
  tripCount,
  tripError,
}: {
  savedCount?: number;
  savedError: boolean;
  tripCount?: number;
  tripError: boolean;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <View style={styles.sectionHeadingCopy}>
          <Text style={styles.sectionEyebrow}>ĐÃ LƯU CÙNG RONG</Text>
          <Text style={styles.sectionTitle} accessibilityRole="header">Dữ liệu của bạn</Text>
        </View>
      </View>
      <View style={styles.dataGroup}>
        <Row
          icon="heartFill"
          tint={Palette.terracotta700}
          label="Muốn đi"
          detail={savedCount === undefined ? (savedError ? 'Chưa tải được danh sách' : 'Đang tải…') : `${savedCount} địa điểm đã lưu`}
          count={savedCount === undefined ? '—' : String(savedCount)}
          onPress={() => router.push('/saved')}
        />
        <View style={styles.rowDivider} />
        <Row
          icon="calendar"
          tint={Palette.forest700}
          label="Chuyến đi"
          detail={tripCount === undefined ? (tripError ? 'Chưa tải được lịch trình' : 'Đang tải lịch trình…') : `${tripCount} hành trình đã lên lịch`}
          count={tripCount === undefined ? '—' : String(tripCount)}
          onPress={() => router.navigate('/trips')}
        />
      </View>
    </View>
  );
}

function Row({
  icon,
  tint,
  label,
  detail,
  count,
  onPress,
}: {
  icon: IconName;
  tint: string;
  label: string;
  detail: string;
  count: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [styles.dataRow, pressed && styles.pressed]}>
      <View style={[styles.dataIcon, { backgroundColor: label === 'Muốn đi' ? Palette.terracotta100 : Palette.forest100 }]}>
        <Icon name={icon} size={19} color={tint} />
      </View>
      <View style={styles.dataCopy}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={styles.rowDetail} numberOfLines={1}>{detail}</Text>
      </View>
      <Text style={styles.dataCount}>{count}</Text>
      <Icon name="forward" size={16} color={Palette.charcoalMuted} />
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
      await deleteAccount();
    } catch (error) {
      setDeleting(false);
      Alert.alert('Chưa xóa được tài khoản', error instanceof ApiError ? error.message : 'Thử lại sau.');
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
    <View style={styles.deleteSection}>
      <Button label="Xóa tài khoản" variant="danger" loading={deleting} onPress={confirm} />
      <Text style={styles.deleteHint}>Xóa hẳn tài khoản cùng mọi lịch trình và địa điểm đã lưu.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Palette.parchment50 },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingTop: 0, gap: Spacing.six },
  stickyHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.four, paddingTop: Spacing.four, paddingBottom: Spacing.six,
    backgroundColor: Palette.parchment50, zIndex: 1,
    borderBottomLeftRadius: Radius.lg, borderBottomRightRadius: Radius.lg,
  },
  stickyHeaderScrolled: { ...Shadow.header },
  headerCopy: { gap: Spacing.one },
  pageTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 27, lineHeight: 35, color: Palette.forest900 },
  headerMark: { width: 40, height: 40, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.forest100 },
  profileCard: {
    overflow: 'hidden', padding: Spacing.four, borderRadius: Radius.lg, backgroundColor: Palette.forest900,
  },
  profileDecoration: {
    position: 'absolute', right: -34, bottom: -60, width: 190, height: 190,
    borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,222,174,0.12)',
  },
  profileTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileLabel: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, letterSpacing: 1.1, color: Palette.turmeric100 },
  profileMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginTop: Spacing.four },
  avatar: {
    width: 58, height: 58, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Palette.forest700, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
  },
  avatarInitial: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 28, color: Palette.onPine },
  profileIdentity: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  profileName: { flexShrink: 1, fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: Palette.onPine },
  verifiedBadge: { width: 17, height: 17, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.forest100 },
  profileEmail: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: 'rgba(255,255,255,0.82)' },
  profileJoined: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 9, color: Palette.forest200 },
  profileDivider: { height: StyleSheet.hairlineWidth, marginTop: Spacing.four, marginBottom: Spacing.three, backgroundColor: 'rgba(255,255,255,0.2)' },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: Palette.onPine },
  statLabel: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 9, color: Palette.forest200 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: 'rgba(255,255,255,0.2)' },
  profileSlogan: { alignSelf: 'flex-end', marginTop: Spacing.two, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, letterSpacing: 0.6, color: Palette.turmeric100 },
  section: { gap: Spacing.two },
  nameSection: { gap: Spacing.two },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  sectionHeadingCopy: { gap: 1 },
  sectionEyebrow: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 8, letterSpacing: 1.1, color: Palette.terracotta700 },
  sectionTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, lineHeight: 25, color: Palette.charcoal },
  editButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.two, paddingLeft: Spacing.two },
  editButtonText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: Palette.forest700 },
  editForm: { gap: Spacing.two },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
  displayNameCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.three,
    padding: Spacing.three, borderRadius: Radius.md, backgroundColor: '#FFFFFF',
  },
  displayNameIcon: { width: 38, height: 38, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.forest100 },
  displayNameCopy: { flex: 1, gap: 2 },
  displayNameValue: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: Palette.charcoal },
  rowTitle: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: Palette.charcoal },
  rowDetail: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 9, lineHeight: 14, color: Palette.charcoalMuted },
  aiPill: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Radius.pill, backgroundColor: Palette.terracotta100 },
  aiPillText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, color: Palette.terracotta700 },
  sectionDescription: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, lineHeight: 15, color: Palette.charcoalMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.one },
  dataGroup: { overflow: 'hidden', borderRadius: Radius.lg, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: Palette.parchment200 },
  dataRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three },
  dataIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  dataCopy: { flex: 1, gap: 2 },
  dataCount: { minWidth: 28, textAlign: 'center', fontFamily: 'PlayfairDisplay_700Bold', fontSize: 17, color: Palette.forest700 },
  rowDivider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three + 40 + Spacing.three, backgroundColor: Palette.parchment300 },
  moreSection: { gap: Spacing.two },
  utilityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderRadius: Radius.md, backgroundColor: '#FFFFFF' },
  utilityIcon: { width: 38, height: 38, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.forest100 },
  utilityCopy: { flex: 1, gap: 2 },
  accountActions: { gap: Spacing.three, alignItems: 'stretch', paddingTop: Spacing.two },
  deleteSection: { gap: Spacing.two, alignItems: 'center' },
  deleteHint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 9, lineHeight: 14, textAlign: 'center', color: Palette.charcoalMuted },
  brandFooter: { marginTop: Spacing.one, textAlign: 'center', fontFamily: 'PlusJakartaSans_400Regular', fontSize: 9, color: Palette.charcoalMuted },
  pressed: { opacity: 0.76 },
});
