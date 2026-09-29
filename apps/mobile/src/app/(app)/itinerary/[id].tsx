import type { Itinerary, ItineraryDay, ItineraryItem, ItineraryWarning } from '@rong/shared-types';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { ScrollViewContainer } from 'react-native-reorderable-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-context';
import { Glass } from '@/components/glass';
import { ItineraryEditor } from '@/components/itinerary-editor';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';
import { useItinerary } from '@/hooks/use-itineraries';
import { useItineraryEditor, type SaveState } from '@/hooks/use-itinerary-editor';
import { ApiError } from '@/lib/api';
import {
  BUDGET_LABELS,
  formatDateRange,
  formatDuration,
  formatKm,
  formatPlanDate,
  formatTime,
  MEAL_LABELS,
  PLANNER_LABELS,
  TRAVEL_PARTY_LABELS,
} from '@/lib/trip-format';

/**
 * `regionName` truyền từ nơi mở: lịch trình chỉ lưu `regionId`. `edit=1` mở
 * thẳng chế độ sửa (vừa tạo lịch trình "Tự sắp xếp").
 */
type Params = { id: string; regionName?: string; edit?: string };

export default function ItineraryScreen() {
  const { id, regionName, edit } = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const itinerary = useItinerary(id);
  const editor = useItineraryEditor(itinerary.data);
  const [editing, setEditing] = useState(edit === '1');
  const data = editor.itinerary ?? itinerary.data;

  return (
    <Screen edges={['top']}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => router.back()}>
          <Glass shape="circle" interactive style={styles.backGlass}>
            <Icon name="back" color={Colors.light.text} />
          </Glass>
        </Pressable>
        {data ? (
          <View style={styles.topActions}>
            {editing ? (
              <>
                <SaveStatus state={editor.saveState} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Hoàn tác"
                  accessibilityState={{ disabled: !editor.canUndo }}
                  disabled={!editor.canUndo}
                  onPress={editor.undo}>
                  <Glass shape="circle" interactive style={[styles.backGlass, !editor.canUndo && styles.disabled]}>
                    <Icon name="undo" color={Colors.light.text} />
                  </Glass>
                </Pressable>
              </>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => setEditing((v) => !v)}>
              <Glass shape="capsule" variant={editing ? 'tinted' : 'regular'} interactive style={styles.editGlass}>
                {editing ? null : <Icon name="edit" size={18} color={Colors.light.primary} />}
                <Text style={[styles.editLabel, editing && { color: Colors.light.onPrimary }]}>{editing ? 'Xong' : 'Sửa'}</Text>
              </Glass>
            </Pressable>
          </View>
        ) : null}
      </View>

      <ScrollViewContainer
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.eight }]}
        refreshControl={
          // Kéo để tải lại xung đột với kéo thả trên Android, và có thể ghi đè thay đổi chưa lưu.
          data && !editing ? (
            <RefreshControl refreshing={itinerary.status === 'refreshing'} onRefresh={itinerary.reload} tintColor={Colors.light.primary} />
          ) : undefined
        }>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {regionName ?? 'Lịch trình'}
          </Text>
          {data ? <Summary itinerary={data} /> : null}
        </View>

        {itinerary.status === 'loading' ? <ActivityIndicator color={Colors.light.primary} accessibilityLabel="Đang tải" style={styles.loading} /> : null}

        {itinerary.status === 'error' && itinerary.error ? (
          <Notice
            tone="danger"
            title={itinerary.error.code === 'ITINERARY_NOT_FOUND' ? 'Không tìm thấy lịch trình' : 'Chưa tải được lịch trình'}
            action={
              itinerary.error.code === 'ITINERARY_NOT_FOUND' ? null : (
                <Button label="Thử lại" variant="plain" size="sm" onPress={itinerary.reload} style={styles.inlineAction} />
              )
            }>
            {itinerary.error.message}
          </Notice>
        ) : null}

        {editing && editor.saveState === 'error' && editor.error ? (
          <Notice
            tone="danger"
            title="Chưa lưu được thay đổi"
            action={<Button label="Thử lại" variant="plain" size="sm" onPress={editor.retry} style={styles.inlineAction} />}>
            {editor.error.message}
          </Notice>
        ) : null}

        {data && editing ? (
          <>
            <Text style={styles.hint}>
              Giữ ≡ rồi kéo để đổi thứ tự trong ngày. Chạm một mục để chuyển ngày, đổi giờ hoặc xóa. Thay đổi được lưu tự động.
            </Text>
            <ItineraryEditor itinerary={data} apply={editor.apply} regionName={regionName ?? 'vùng này'} />
          </>
        ) : null}
        {data && !editing ? <ItineraryBody itinerary={data} /> : null}
      </ScrollViewContainer>
    </Screen>
  );
}

/** Tự động lưu (FR-8.9): cho biết thay đổi đã lên server chưa. */
function SaveStatus({ state }: { state: SaveState }) {
  const label =
    state === 'pending' || state === 'saving' ? 'Đang lưu…' : state === 'saved' ? 'Đã lưu' : state === 'error' ? 'Chưa lưu' : null;
  if (!label) return null;
  return (
    <Text style={[styles.saveStatus, state === 'error' && { color: Colors.light.danger }]} accessibilityLiveRegion="polite">
      {label}
    </Text>
  );
}

function Summary({ itinerary }: { itinerary: Itinerary }) {
  const { input } = itinerary;
  const people = [`${input.adults} người lớn`, input.children ? `${input.children} trẻ em` : null].filter(Boolean).join(', ');

  return (
    <View style={styles.summary}>
      <Text style={styles.meta}>
        {formatDateRange(input.startsAt, input.endsAt)} · {itinerary.days.length} ngày
      </Text>
      <Text style={styles.meta}>
        {TRAVEL_PARTY_LABELS[input.travelParty]} · {people} · {BUDGET_LABELS[input.budgetTier]}
      </Text>
      <View style={[styles.badge, itinerary.planner === 'ai' && styles.aiBadge]}>
        {itinerary.planner === 'ai' ? <Icon name="sparkles" size={14} color={Colors.light.ai} /> : null}
        <Text style={[styles.badgeText, itinerary.planner === 'ai' && { color: Colors.light.ai }]}>{PLANNER_LABELS[itinerary.planner]}</Text>
      </View>
    </View>
  );
}

function ItineraryBody({ itinerary }: { itinerary: Itinerary }) {
  const general = itinerary.warnings.filter((w) => !w.dayId);

  return (
    <>
      {itinerary.planner === 'heuristic' ? (
        <Notice title="AI đang bận">Lịch trình được xếp tự động theo khoảng cách và giờ mở cửa, chưa có lý do cho từng điểm.</Notice>
      ) : null}
      <Warnings warnings={general} />

      {itinerary.days.map((day, index) => (
        <DaySection key={day.id} day={day} index={index} warnings={itinerary.warnings.filter((w) => w.dayId === day.id)} />
      ))}

      {itinerary.unscheduled.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Chưa xếp được
          </Text>
          {itinerary.unscheduled.map((u) => (
            <Pressable
              key={u.placeId}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/place/[id]', params: { id: u.placeId, ...(u.name && { name: u.name }) } })}
              style={({ pressed }) => [styles.unscheduled, pressed && styles.pressed]}>
              <Text style={styles.itemName}>{u.name ?? 'Địa điểm đã chọn'}</Text>
              <Text style={styles.meta}>{u.reason}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {itinerary.tips.length > 0 ? (
        <View style={styles.tips}>
          <View style={styles.row}>
            <Icon name="sparkles" size={16} color={Colors.light.ai} />
            <Text style={[styles.sectionTitle, { color: Colors.light.ai }]} accessibilityRole="header">
              Mẹo cho chuyến đi
            </Text>
          </View>
          {itinerary.tips.map((tip) => (
            <Text key={tip} style={styles.body}>
              • {tip}
            </Text>
          ))}
          <Text style={styles.hint}>Do AI viết, hãy kiểm tra lại trước khi đi.</Text>
        </View>
      ) : null}

      <DeleteButton id={itinerary.id} />
    </>
  );
}

function DaySection({ day, index, warnings }: { day: ItineraryDay; index: number; warnings: ItineraryWarning[] }) {
  return (
    <View style={styles.section}>
      <View>
        <Text style={styles.dayTitle} accessibilityRole="header">
          Ngày {index + 1}
        </Text>
        <Text style={styles.meta}>
          {formatPlanDate(day.date)} · {formatTime(day.startsAt)}–{formatTime(day.endsAt)}
        </Text>
      </View>
      <Warnings warnings={warnings} />
      {day.items.length === 0 ? <Text style={styles.hint}>Chưa có hoạt động nào trong ngày này.</Text> : null}
      <View>
        {day.items.map((item, i) => (
          <View key={item.id}>
            {i > 0 && item.travelMinutesFromPrevious ? <TravelLeg item={item} /> : null}
            <ItemCard item={item} />
          </View>
        ))}
      </View>
    </View>
  );
}

function TravelLeg({ item }: { item: ItineraryItem }) {
  const parts = [formatDuration(item.travelMinutesFromPrevious!), item.distanceKmFromPrevious ? formatKm(item.distanceKmFromPrevious) : null];
  return (
    <View style={styles.leg} accessible accessibilityLabel={`Di chuyển ${parts.filter(Boolean).join(', ')}`}>
      <View style={styles.legLine} />
      <Icon name="route" size={14} />
      <Text style={styles.legText}>{parts.filter(Boolean).join(' · ')}</Text>
    </View>
  );
}

function ItemCard({ item }: { item: ItineraryItem }) {
  const time = `${formatTime(item.startsAt)}–${formatTime(item.endsAt)}`;
  const icon: IconName = item.kind === 'rest' ? 'stay' : item.kind === 'meal' ? 'food' : ((item.place?.category as IconName | undefined) ?? 'pin');
  const title = item.place?.name ?? (item.kind === 'rest' ? 'Nghỉ ngơi' : 'Hoạt động');
  const kind =
    item.kind === 'meal' && item.mealType
      ? MEAL_LABELS[item.mealType]
      : item.kind === 'rest'
        ? 'Nghỉ ngơi'
        : (CATEGORY_LABELS[item.place?.category as keyof typeof CATEGORY_LABELS] ?? null);
  const canOpen = !!item.placeId && item.kind !== 'rest';

  const content = (
    <>
      <View style={styles.itemIcon}>
        <Icon name={icon} size={18} color={Colors.light.primary} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.time}>{time}</Text>
        <Text style={styles.itemName}>{title}</Text>
        {kind ? <Text style={styles.meta}>{kind}</Text> : null}
        {item.reason ? <Text style={styles.reason}>{item.reason}</Text> : null}
        {item.isAiSuggested ? (
          <View style={[styles.badge, styles.aiBadge, styles.itemBadge]}>
            <Icon name="sparkles" size={12} color={Colors.light.ai} />
            <Text style={[styles.badgeText, { color: Colors.light.ai }]}>AI gợi ý</Text>
          </View>
        ) : null}
      </View>
      {canOpen ? <Icon name="forward" size={16} /> : null}
    </>
  );

  if (!canOpen) return <View style={styles.item}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Mở chi tiết địa điểm"
      onPress={() => router.push({ pathname: '/place/[id]', params: { id: item.placeId!, name: title } })}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

function Warnings({ warnings }: { warnings: ItineraryWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <View style={styles.warnings}>
      {warnings.map((w, i) => (
        <View key={`${w.type}-${w.itemId ?? i}`} style={styles.warning}>
          <Icon name="warning" size={16} color={Colors.light.warning} />
          <Text style={[styles.body, styles.flex]}>{w.message}</Text>
        </View>
      ))}
    </View>
  );
}

function DeleteButton({ id }: { id: string }) {
  const { authFetch } = useAuth();
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await authFetch<void>(`/itineraries/${id}`, { method: 'DELETE' });
      router.back();
    } catch (e) {
      setDeleting(false);
      Alert.alert('Chưa xóa được lịch trình', e instanceof ApiError ? e.message : 'Thử lại sau.');
    }
  };

  const confirm = () =>
    Alert.alert('Xóa lịch trình này?', 'Không thể hoàn tác.', [
      { text: 'Hủy', style: 'cancel' },
      { text: 'Xóa', style: 'destructive', onPress: remove },
    ]);

  return <Button label="Xóa lịch trình" variant="danger" loading={deleting} onPress={confirm} style={styles.delete} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  editGlass: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: MinTouch, paddingHorizontal: Spacing.four },
  editLabel: { ...Type.subhead, fontFamily: Type.headline.fontFamily, color: Colors.light.primary },
  saveStatus: { ...Type.footnote, color: Colors.light.textSecondary },
  disabled: { opacity: 0.4 },
  backGlass: { width: MinTouch, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: Spacing.four, gap: Spacing.six },
  header: { gap: Spacing.two },
  title: { ...Type.title1, color: Colors.light.text },
  summary: { gap: 2, alignItems: 'flex-start' },
  meta: { ...Type.subhead, color: Colors.light.textSecondary },
  body: { ...Type.callout, color: Colors.light.text },
  hint: { ...Type.footnote, color: Colors.light.textSecondary },
  loading: { paddingVertical: Spacing.six },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.backgroundElement,
  },
  aiBadge: { backgroundColor: Colors.light.aiBackground },
  badgeText: { ...Type.caption, color: Colors.light.textSecondary },
  itemBadge: { alignSelf: 'flex-start', marginTop: Spacing.one },
  section: { gap: Spacing.three },
  sectionTitle: { ...Type.headline, color: Colors.light.text },
  dayTitle: { ...Type.title2, color: Colors.light.text },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
  },
  pressed: { opacity: 0.7 },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.backgroundSelected,
  },
  time: { ...Type.numeric, color: Colors.light.primary },
  itemName: { ...Type.headline, color: Colors.light.text },
  reason: { ...Type.footnote, color: Colors.light.text, marginTop: Spacing.one },
  leg: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingLeft: Spacing.three + 17 },
  legLine: { position: 'absolute', left: Spacing.three + 17, top: 0, bottom: 0, width: 2, backgroundColor: Colors.light.hairline },
  legText: { ...Type.footnote, color: Colors.light.textSecondary },
  warnings: { gap: Spacing.two },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.warningBackground,
  },
  unscheduled: {
    gap: 2,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.light.hairline,
  },
  tips: { gap: Spacing.two, padding: Spacing.four, borderRadius: Radius.lg, borderCurve: 'continuous', backgroundColor: Colors.light.aiBackground },
  delete: { alignSelf: 'center' },
});
