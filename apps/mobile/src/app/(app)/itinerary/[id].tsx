import type { Itinerary, ItineraryDay, ItineraryItem, ItineraryWarning } from '@rong/shared-types';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { ScrollViewContainer } from 'react-native-reorderable-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useAuth } from '@/auth/auth-context';
import { Glass } from '@/components/glass';
import { ItineraryEditor } from '@/components/itinerary-editor';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ApproximateLocation } from '@/components/ui/approximate-location';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Palette, Radius, Shadow, Spacing, Type as BaseType } from '@/constants/theme';
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

type Params = { id: string; regionName?: string; edit?: string };

/** Cặp font theo Stitch Rong, chỉ áp dụng cho màn lịch trình. */
const Type = {
  display: { ...BaseType.display, fontFamily: 'PlayfairDisplay_700Bold' },
  title1: { ...BaseType.title1, fontFamily: 'PlayfairDisplay_700Bold' },
  title2: { ...BaseType.title2, fontFamily: 'PlayfairDisplay_600SemiBold' },
  headline: { ...BaseType.headline, fontFamily: 'PlayfairDisplay_600SemiBold' },
  body: { ...BaseType.body, fontFamily: 'PlusJakartaSans_400Regular' },
  callout: { ...BaseType.callout, fontFamily: 'PlusJakartaSans_400Regular' },
  subhead: { ...BaseType.subhead, fontFamily: 'PlusJakartaSans_500Medium' },
  footnote: { ...BaseType.footnote, fontFamily: 'PlusJakartaSans_400Regular' },
  caption: { ...BaseType.caption, fontFamily: 'PlusJakartaSans_600SemiBold' },
  numeric: { ...BaseType.numeric, fontFamily: 'PlusJakartaSans_600SemiBold' },
};

export default function ItineraryScreen() {
  const { id, regionName, edit } = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const itinerary = useItinerary(id);
  const editor = useItineraryEditor(itinerary.data);
  const [editing, setEditing] = useState(edit === '1');
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const data = editor.itinerary ?? itinerary.data;

  const onShare = async () => {
    if (!data) return;
    try {
      const destination = regionName ? `tại ${regionName}` : '';
      const title = `Lịch trình du ngoạn ${destination} - Rong Thong Dong`.trim();
      const message = `${title}\nThời gian: ${formatDateRange(data.input.startsAt, data.input.endsAt)} (${data.days.length} ngày)\nKhám phá lịch trình cùng Rong Thong Dong!`;
      await Share.share({ title, message });
    } catch {
      // Bỏ qua lỗi huỷ chia sẻ
    }
  };

  return (
    <Screen edges={['top']} style={styles.screen}>
      {/* Top Bar Navigation */}
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quay lại"
          onPress={() => router.back()}>
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
                  <Glass
                    shape="circle"
                    interactive
                    style={[styles.backGlass, !editor.canUndo && styles.disabled]}>
                    <Icon name="undo" color={Colors.light.text} />
                  </Glass>
                </Pressable>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Chia sẻ lịch trình"
                onPress={onShare}>
                <Glass shape="circle" interactive style={styles.backGlass}>
                  <Icon name="share" color={Colors.light.text} />
                </Glass>
              </Pressable>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Xong' : 'Sửa'}
              onPress={() => setEditing((v) => !v)}>
              <Glass
                shape="capsule"
                variant={editing ? 'tinted' : 'regular'}
                interactive
                style={styles.editGlass}>
                {editing ? null : <Icon name="edit" size={18} color={Colors.light.primary} />}
                <Text style={[styles.editLabel, editing && { color: Colors.light.onPrimary }]}>
                  {editing ? 'Xong' : 'Sửa'}
                </Text>
              </Glass>
            </Pressable>
          </View>
        ) : null}
      </View>

      <ScrollViewContainer
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + (editing ? Spacing.eight : data?.tips.length ? 84 : Spacing.four) },
        ]}
        refreshControl={
          data && !editing ? (
            <RefreshControl
              refreshing={itinerary.status === 'refreshing'}
              onRefresh={itinerary.reload}
              tintColor={Colors.light.primary}
            />
          ) : undefined
        }>
        {/* Loading state */}
        {itinerary.status === 'loading' ? (
          <ActivityIndicator
            color={Colors.light.primary}
            accessibilityLabel="Đang tải"
            style={styles.loading}
          />
        ) : null}

        {/* Error state */}
        {itinerary.status === 'error' && itinerary.error ? (
          <Notice
            tone="danger"
            title={
              itinerary.error.code === 'ITINERARY_NOT_FOUND'
                ? 'Không tìm thấy lịch trình'
                : 'Chưa tải được lịch trình'
            }
            action={
              itinerary.error.code === 'ITINERARY_NOT_FOUND' ? null : (
                <Button
                  label="Thử lại"
                  variant="plain"
                  size="sm"
                  onPress={itinerary.reload}
                  style={styles.inlineAction}
                />
              )
            }>
            {itinerary.error.message}
          </Notice>
        ) : null}

        {/* Save error state */}
        {editing && editor.saveState === 'error' && editor.error ? (
          <Notice
            tone="danger"
            title="Chưa lưu được thay đổi"
            action={
              <Button
                label="Thử lại"
                variant="plain"
                size="sm"
                onPress={editor.retry}
                style={styles.inlineAction}
              />
            }>
            {editor.error.message}
          </Notice>
        ) : null}

        {/* Editing Mode */}
        {data && editing ? (
          <>
            <Text style={styles.hint}>
              Giữ ≡ rồi kéo để đổi thứ tự trong ngày. Chạm một mục để chuyển ngày, đổi giờ hoặc xóa. Thay đổi được lưu tự động.
            </Text>
            <ItineraryEditor
              itinerary={data}
              apply={editor.apply}
              regionName={regionName ?? 'vùng này'}
            />
          </>
        ) : null}

        {/* View Mode (Stitch Editorial Journal) */}
        {data && !editing ? (
          <ItineraryViewBody
            itinerary={data}
            regionName={regionName}
            selectedDayIndex={selectedDayIndex}
            onSelectDay={setSelectedDayIndex}
            onStartEdit={() => setEditing(true)}
          />
        ) : null}
      </ScrollViewContainer>

      {data && !editing && data.tips.length > 0 ? <AiTipsAccess tips={data.tips} /> : null}
    </Screen>
  );
}

/** Tự động lưu: cho biết thay đổi đã lên server chưa. */
function SaveStatus({ state }: { state: SaveState }) {
  const label =
    state === 'pending' || state === 'saving'
      ? 'Đang lưu…'
      : state === 'saved'
        ? 'Đã lưu'
        : state === 'error'
          ? 'Chưa lưu'
          : null;
  if (!label) return null;
  return (
    <Text
      style={[styles.saveStatus, state === 'error' && { color: Colors.light.danger }]}
      accessibilityLiveRegion="polite">
      {label}
    </Text>
  );
}

type ItineraryViewBodyProps = {
  itinerary: Itinerary;
  regionName?: string;
  selectedDayIndex: number;
  onSelectDay: (index: number) => void;
  onStartEdit: () => void;
};

function ItineraryViewBody({
  itinerary,
  regionName,
  selectedDayIndex,
  onSelectDay,
  onStartEdit,
}: ItineraryViewBodyProps) {
  const { input } = itinerary;
  const people = [`${input.adults} người lớn`, input.children ? `${input.children} trẻ em` : null]
    .filter(Boolean)
    .join(', ');

  const currentDay = itinerary.days[selectedDayIndex] ?? itinerary.days[0];
  const totalActivities = itinerary.days.reduce((total, day) => total + day.items.length, 0);
  const routeStops = currentDay?.items
    .map((item) => item.place?.name)
    .filter((name): name is string => !!name) ?? [];
  const routePreview = routeStops.slice(0, 3).join(' → ');
  const remainingStops = Math.max(0, routeStops.length - 3);
  const generalWarnings = itinerary.warnings.filter((w) => !w.dayId);
  const dayWarnings = currentDay
    ? itinerary.warnings.filter((w) => w.dayId === currentDay.id)
    : [];

  return (
    <>
      {/* 1. Destination Title & Metadata Area */}
      <View style={styles.destinationHeader}>
        <View style={styles.titleRow}>
          <ThemedText type="display" style={styles.destinationTitle}>
            {regionName ?? 'Lịch trình'}
          </ThemedText>
          <View style={styles.destinationBadge}>
            <View style={styles.badgePulseDot} />
            <Text style={styles.destinationBadgeText}>Chuyến đi</Text>
          </View>
        </View>

        <Text style={styles.tripDateRow}>
          {formatDateRange(input.startsAt, input.endsAt)} · {itinerary.days.length} ngày
        </Text>

        <View style={styles.tripTagList}>
          <View style={styles.tripTag}>
            <Text style={styles.tripTagText}>
              {TRAVEL_PARTY_LABELS[input.travelParty]} • {people}
            </Text>
          </View>
          <View style={styles.tripTag}>
            <Text style={styles.tripTagText}>{BUDGET_LABELS[input.budgetTier]}</Text>
          </View>
          <View style={[styles.tripTag, styles.tripTagAccent]}>
            <Icon name="sparkles" size={12} color={Palette.forest700} />
            <Text style={[styles.tripTagText, { color: Palette.forest700, fontWeight: '600' }]}>
              {PLANNER_LABELS[itinerary.planner]}
            </Text>
          </View>
        </View>
      </View>

      {/* 2. Route summary */}
      <View style={styles.miniOverviewCard}>
        <View style={styles.routeMiniBar}>
          <View style={styles.routeLeft}>
            <View style={styles.routeMapIcon}>
              <Icon name="route" size={16} color={Palette.forest900} />
            </View>
            <View>
              <Text style={styles.routeTitle}>
                {currentDay ? `Lộ trình ngày ${selectedDayIndex + 1}` : 'Lộ trình'}
              </Text>
              <Text style={styles.routeSubtitle}>
                {currentDay
                  ? `${routeStops.length} điểm dừng hôm nay`
                  : `${itinerary.days.length} ngày · ${totalActivities} hoạt động`}
              </Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Xem bản đồ vùng"
            onPress={() =>
              router.push({
                pathname: '/region/[id]',
                params: { id: itinerary.regionId, ...(regionName && { name: regionName }) },
              })
            }
            style={styles.viewMapBtn}>
            <Text style={styles.viewMapBtnText}>Bản đồ</Text>
            <Icon name="forward" size={13} color={Colors.light.secondary} />
          </Pressable>
        </View>
        {routePreview ? (
          <Text style={styles.routePreview} numberOfLines={2}>
            {routePreview}{remainingStops > 0 ? ` → +${remainingStops} điểm` : ''}
          </Text>
        ) : null}
      </View>

      {/* 3. Itinerary note */}
      <View style={styles.aiNoteCard}>
        <View style={styles.aiNoteHeader}>
          <View style={styles.aiNoteSparkleCircle}>
            <Icon name="sparkles" size={16} color={Palette.forest900} />
          </View>
          <View style={styles.flex}>
            <View style={styles.aiNoteTitleRow}>
              <Text style={styles.aiNoteTitle}>
                {itinerary.planner === 'ai' ? 'Rong AI ghi chú' : 'Ghi chú lịch trình'}
              </Text>
              <View style={styles.optimizedBadge}>
                <Text style={styles.optimizedBadgeText}>{PLANNER_LABELS[itinerary.planner]}</Text>
              </View>
            </View>
            <Text style={styles.aiNoteDesc}>
              {`${itinerary.days.length} ngày với ${totalActivities} hoạt động. Bạn có thể đổi thứ tự, giờ hoặc địa điểm bất cứ lúc nào.`}
            </Text>
          </View>
        </View>

        <View style={styles.aiNoteFooter}>
          <Text style={styles.aiNoteTime}>Thông tin chuyến đi</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tự tay sắp xếp lại"
            onPress={onStartEdit}
            style={styles.reorderLink}>
            <Text style={styles.reorderLinkText}>Tự tay sắp xếp lại</Text>
            <Icon name="forward" size={14} color={Palette.forest700} />
          </Pressable>
        </View>
      </View>

      {/* 4. Day Navigation Tabs (Horizontal Scroll) */}
      <View style={styles.dayNavSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dayNavTabs}>
          {itinerary.days.map((day, idx) => {
            const active = idx === selectedDayIndex;
            return (
              <Pressable
                key={day.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onSelectDay(idx)}
                style={[styles.dayTab, active ? styles.dayTabActive : styles.dayTabInactive]}>
                {active ? <View style={styles.dayTabDot} /> : null}
                <Text style={[styles.dayTabText, active && styles.dayTabTextActive]}>
                  Ngày {idx + 1} • {formatPlanDate(day.date)}
                </Text>
                <View
                  style={[styles.dayCountBadge, active && styles.dayCountBadgeActive]}>
                  <Text
                    style={[styles.dayCountText, active && styles.dayCountTextActive]}>
                    {day.items.length} điểm
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Selected Day Header */}
        {currentDay ? (
          <View style={styles.currentDayHeadlineRow}>
            <View>
              <ThemedText type="title1" style={styles.currentDayTitle}>
                Ngày {selectedDayIndex + 1}
              </ThemedText>
              <Text style={styles.currentDayMeta}>
                {formatPlanDate(currentDay.date)} • {formatTime(currentDay.startsAt)}–{formatTime(currentDay.endsAt)}
              </Text>
            </View>
            <View style={styles.dayFocusBadge}>
              <Text style={styles.dayFocusText}>Lộ trình chính</Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* 5. Warnings & Alerts */}
      <Warnings warnings={[...generalWarnings, ...dayWarnings]} />

      {/* 6. Timeline Itinerary */}
      {currentDay ? (
        <View style={styles.timelineSection}>
          {currentDay.items.length === 0 ? (
            <Text style={styles.hint}>Chưa có hoạt động nào trong ngày này.</Text>
          ) : null}

          {currentDay.items.map((item, idx) => (
            <View key={item.id}>
              {idx > 0 && item.travelMinutesFromPrevious ? (
                <TimelineTravelLeg item={item} />
              ) : null}
              <TimelineItemCard item={item} stopIndex={idx + 1} />
            </View>
          ))}
        </View>
      ) : null}

      {/* 7. Unscheduled Places */}
      {itinerary.unscheduled.length > 0 ? (
        <View style={styles.unscheduledSection}>
          <Text style={styles.sectionHeaderTitle} accessibilityRole="header">
            Chưa xếp được
          </Text>
          {itinerary.unscheduled.map((u) => (
            <Pressable
              key={u.placeId}
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: '/place/[id]',
                  params: { id: u.placeId, ...(u.name && { name: u.name }) },
                })
              }
              style={({ pressed }) => [styles.unscheduledCard, pressed && styles.pressed]}>
              <Text style={styles.unscheduledName}>{u.name ?? 'Địa điểm đã chọn'}</Text>
              <Text style={styles.meta}>{u.reason}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <DeleteButton id={itinerary.id} />
    </>
  );
}

function AiTipsAccess({ tips }: { tips: string[] }) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const pulse = useSharedValue(1);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1.06, { duration: 1100, reduceMotion: ReduceMotion.System }),
      -1,
      true,
      undefined,
      ReduceMotion.System,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  return (
    <>
      <Animated.View style={[styles.aiTipsButtonWrap, { bottom: insets.bottom + Spacing.three }, pulseStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mở mẹo Rong AI cho chuyến đi"
          accessibilityHint="Hiển thị các gợi ý cần lưu ý trước khi khởi hành"
          onPress={() => setVisible(true)}
          style={({ pressed }) => [styles.aiTipsButton, pressed && styles.pressed]}>
          <Icon name="sparkles" size={23} color={Palette.onPine} />
        </Pressable>
      </Animated.View>

      <Modal
        visible={visible}
        transparent
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setVisible(false)}>
        <View style={styles.tipsModalBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Đóng mẹo Rong AI"
            onPress={() => setVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.tipsModalCard, { paddingBottom: Math.max(insets.bottom, Spacing.four) }]}>
            <View style={styles.tipsModalHeader}>
              <View style={styles.tipsModalTitleGroup}>
                <View style={styles.tipsModalIcon}>
                  <Icon name="sparkles" size={17} color={Palette.forest900} />
                </View>
                <View>
                  <Text style={styles.tipsModalEyebrow}>RONG AI · GỢI Ý</Text>
                  <Text style={styles.tipsTitle} accessibilityRole="header">Mẹo cho chuyến đi</Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Đóng"
                onPress={() => setVisible(false)}
                hitSlop={8}
                style={({ pressed }) => [styles.tipsCloseButton, pressed && styles.pressed]}>
                <Icon name="close" size={18} color={Palette.charcoal} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.tipsModalList}>
              {tips.map((tip, index) => (
                <View key={`${index}-${tip}`} style={styles.tipRow}>
                  <View style={styles.tipBullet}><Text style={styles.tipBulletText}>{index + 1}</Text></View>
                  <Text style={styles.tipItem}>{tip}</Text>
                </View>
              ))}
              <Text style={styles.tipDisclaimer}>Gợi ý từ Rong AI, hãy kiểm tra lại trước khi khởi hành.</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function TimelineTravelLeg({ item }: { item: ItineraryItem }) {
  const parts = [
    formatDuration(item.travelMinutesFromPrevious!),
    item.distanceKmFromPrevious ? formatKm(item.distanceKmFromPrevious) : null,
  ];

  return (
    <View style={styles.travelLegRow} accessible accessibilityLabel={`Di chuyển ${parts.filter(Boolean).join(', ')}`}>
      <View style={styles.travelRailLine} />
      <View style={styles.travelLegPill}>
        <Text style={styles.travelLegDuration}>⤹ {formatDuration(item.travelMinutesFromPrevious!)}</Text>
        <View style={styles.travelLegDot} />
        {item.distanceKmFromPrevious ? (
          <Text style={styles.travelLegDistance}>{formatKm(item.distanceKmFromPrevious)}</Text>
        ) : null}
        <Text style={styles.travelLegMode}>• Di chuyển</Text>
      </View>
    </View>
  );
}

function TimelineItemCard({ item, stopIndex }: { item: ItineraryItem; stopIndex: number }) {
  const time = `${formatTime(item.startsAt)}–${formatTime(item.endsAt)}`;
  const icon: IconName =
    item.kind === 'rest'
      ? 'stay'
      : item.kind === 'meal'
        ? 'food'
        : ((item.place?.category as IconName | undefined) ?? 'pin');
  const title = item.place?.name ?? (item.kind === 'rest' ? 'Nghỉ ngơi' : 'Hoạt động');
  const kind =
    item.kind === 'meal' && item.mealType
      ? MEAL_LABELS[item.mealType]
      : item.kind === 'rest'
        ? 'Nghỉ ngơi'
        : (CATEGORY_LABELS[item.place?.category as keyof typeof CATEGORY_LABELS] ?? null);
  const canOpen = !!item.placeId && item.kind !== 'rest';

  const cardContent = (
    <View style={styles.timelineItemRow}>
      {/* Connecting Vertical Line */}
      <View style={styles.timelineRailLine} />

      {/* Number Badge */}
      <View style={styles.timelineNodeBadge}>
        <Text style={styles.timelineNodeText}>{stopIndex}</Text>
      </View>

      {/* Card Content */}
      <View style={styles.stopCard}>
        <View style={styles.stopCardHeader}>
          <View style={styles.stopCardHeaderLeft}>
            <View style={styles.stopIconCircle}>
              <Icon name={icon} size={18} color={Palette.forest900} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.stopTimeSlot}>{time}</Text>
              <Text style={styles.stopTitle}>{title}</Text>
              {kind ? <Text style={styles.stopSubtitle}>{kind}</Text> : null}
            </View>
          </View>
          {canOpen ? (
            <View style={styles.stopArrowContainer}>
              <Icon name="forward" size={16} color={Colors.light.textDisabled} />
            </View>
          ) : null}
        </View>

        {/* Badges & Reason */}
        <View style={styles.stopBadgesRow}>
          {item.place?.locationSource === 'ai' ? <ApproximateLocation compact /> : null}
          {item.isAiSuggested ? (
            <View style={styles.aiTag}>
              <Icon name="sparkles" size={12} color={Palette.forest700} />
              <Text style={styles.aiTagText}>AI gợi ý</Text>
            </View>
          ) : null}
        </View>

        {item.reason ? <Text style={styles.stopReasonText}>{item.reason}</Text> : null}
      </View>
    </View>
  );

  if (!canOpen) return cardContent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Mở chi tiết địa điểm"
      onPress={() =>
        router.push({ pathname: '/place/[id]', params: { id: item.placeId!, name: title } })
      }
      style={({ pressed }) => [pressed && styles.pressed]}>
      {cardContent}
    </Pressable>
  );
}

function Warnings({ warnings }: { warnings: ItineraryWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <View style={styles.warningsList}>
      {warnings.map((w, i) => (
        <View key={`${w.type}-${w.itemId ?? i}`} style={styles.warningCard}>
          <View style={styles.warningIconCircle}>
            <Icon name="warning" size={14} color={Colors.light.warning} />
          </View>
          <Text style={[styles.warningText, styles.flex]}>{w.message}</Text>
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

  return (
    <Button
      label="Xóa lịch trình"
      variant="danger"
      loading={deleting}
      onPress={confirm}
      style={styles.deleteBtn}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: {
    backgroundColor: Palette.parchment50,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  backGlass: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
  editGlass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.four,
  },
  editLabel: { ...Type.subhead, fontFamily: Type.headline.fontFamily, color: Colors.light.primary },
  saveStatus: { ...Type.footnote, color: Colors.light.textSecondary },
  disabled: { opacity: 0.4 },
  content: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  loading: { paddingVertical: Spacing.six },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
  hint: { ...Type.footnote, color: Colors.light.textSecondary },
  pressed: { opacity: 0.8 },

  /* 1. Destination Header */
  destinationHeader: {
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  destinationTitle: {
    fontFamily: 'PlayfairDisplay_700Bold',
    color: Palette.forest900,
    flex: 1,
  },
  destinationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    backgroundColor: Palette.forest100,
    borderWidth: 1,
    borderColor: Palette.forest200,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 4,
    borderRadius: Radius.sm,
  },
  badgePulseDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: Palette.forest700,
  },
  destinationBadgeText: {
    ...Type.caption,
    fontSize: 10,
    color: Palette.forest700,
    letterSpacing: 0,
  },
  tripDateRow: {
    ...Type.subhead,
    color: Colors.light.textSecondary,
  },
  tripTagList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one + 2,
    marginTop: Spacing.one,
  },
  tripTag: {
    backgroundColor: 'rgba(230, 234, 229, 0.7)',
    paddingHorizontal: Spacing.three,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  tripTagAccent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Palette.forest100,
  },
  tripTagText: {
    ...Type.caption,
    color: Colors.light.textSecondary,
    fontWeight: '500',
  },

  /* 2. Visual Weather & Route Mini Card */
  miniOverviewCard: {
    backgroundColor: Palette.parchment100,
    borderRadius: Radius.lg,
    padding: Spacing.three + 2,
    borderWidth: 1,
    borderColor: Palette.mist200,
    gap: Spacing.two + 2,
    ...Shadow.card,
  },
  routeMiniBar: {
    backgroundColor: Palette.surface,
    borderRadius: Radius.md,
    padding: Spacing.two + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Palette.mist200,
  },
  routeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  routeMapIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    backgroundColor: Palette.forest100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeTitle: {
    ...Type.subhead,
    fontWeight: '700',
    color: Palette.forest900,
  },
  routeSubtitle: {
    ...Type.caption,
    fontSize: 11,
    color: Colors.light.textSecondary,
  },
  routePreview: {
    ...Type.footnote,
    color: Palette.charcoalMuted,
    lineHeight: 19,
    paddingHorizontal: Spacing.one,
  },
  viewMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Palette.terracotta100,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one,
    borderRadius: Radius.sm,
  },
  viewMapBtnText: {
    ...Type.caption,
    color: Colors.light.secondary,
    fontWeight: '700',
  },

  /* 3. Rong AI Note Card */
  aiNoteCard: {
    backgroundColor: Palette.surface,
    borderRadius: Radius.lg,
    padding: Spacing.four,
    borderWidth: 1,
    borderColor: Palette.mist200,
    gap: Spacing.three,
    ...Shadow.card,
  },
  aiNoteHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  aiNoteSparkleCircle: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    backgroundColor: Palette.forest100,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  aiNoteTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  aiNoteTitle: {
    ...Type.headline,
    color: Palette.forest900,
  },
  optimizedBadge: {
    backgroundColor: Palette.forest100,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  optimizedBadgeText: {
    ...Type.caption,
    fontSize: 10,
    color: Palette.forest700,
    fontWeight: '700',
  },
  aiNoteDesc: {
    ...Type.body,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.light.textSecondary,
  },
  aiNoteFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Palette.mist100,
    paddingTop: Spacing.two,
  },
  aiNoteTime: {
    ...Type.caption,
    fontSize: 11,
    color: Colors.light.textDisabled,
  },
  reorderLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reorderLinkText: {
    ...Type.caption,
    fontSize: 12,
    fontWeight: '700',
    color: Palette.forest700,
  },

  /* 4. Day Navigation Tabs */
  dayNavSection: {
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  dayNavTabs: {
    gap: Spacing.two,
  },
  dayTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 1,
    borderRadius: Radius.md,
  },
  dayTabActive: {
    backgroundColor: Palette.forest900,
    ...Shadow.card,
  },
  dayTabInactive: {
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.mist200,
  },
  dayTabDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: Palette.turmeric500,
  },
  dayTabText: {
    ...Type.subhead,
    color: Colors.light.textSecondary,
    fontWeight: '600',
  },
  dayTabTextActive: {
    color: Palette.onPine,
  },
  dayCountBadge: {
    backgroundColor: Palette.mist100,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  dayCountBadgeActive: {
    backgroundColor: Palette.forest700,
  },
  dayCountText: {
    ...Type.caption,
    fontSize: 10,
    color: Colors.light.textSecondary,
  },
  dayCountTextActive: {
    color: Palette.forest100,
  },
  currentDayHeadlineRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  currentDayTitle: {
    fontFamily: 'PlayfairDisplay_700Bold',
    color: Palette.forest900,
  },
  currentDayMeta: {
    ...Type.caption,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  dayFocusBadge: {
    backgroundColor: Palette.terracotta100,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(160, 64, 29, 0.2)',
  },
  dayFocusText: {
    ...Type.caption,
    fontSize: 11,
    color: Colors.light.secondary,
    fontWeight: '700',
  },

  /* 5. Warnings List */
  warningsList: {
    gap: Spacing.two,
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    backgroundColor: '#FFF6E5',
    borderWidth: 1,
    borderColor: '#F4DCB0',
    ...Shadow.card,
  },
  warningIconCircle: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(217, 155, 38, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  warningText: {
    ...Type.body,
    fontSize: 13,
    lineHeight: 18,
    color: Palette.charcoal,
  },

  /* 6. Timeline Itinerary */
  timelineSection: {
    position: 'relative',
    paddingLeft: Spacing.six,
  },
  timelineItemRow: {
    position: 'relative',
    paddingBottom: Spacing.four,
  },
  timelineRailLine: {
    position: 'absolute',
    left: -Spacing.four + 4,
    top: 24,
    bottom: 0,
    width: 2,
    backgroundColor: Palette.mist200,
  },
  timelineNodeBadge: {
    position: 'absolute',
    left: -Spacing.five - 2,
    top: 4,
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    backgroundColor: Palette.forest700,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Palette.parchment50,
    zIndex: 10,
    ...Shadow.card,
  },
  timelineNodeText: {
    ...Type.caption,
    fontSize: 11,
    fontWeight: '700',
    color: Palette.onPine,
  },
  stopCard: {
    backgroundColor: Palette.surface,
    borderRadius: Radius.md,
    padding: Spacing.three + 2,
    borderWidth: 1,
    borderColor: Palette.mist200,
    gap: Spacing.two,
    ...Shadow.card,
  },
  stopCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  stopCardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two + 2,
    flex: 1,
  },
  stopIconCircle: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Palette.forest100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopTimeSlot: {
    ...Type.caption,
    fontSize: 11,
    color: Palette.forest700,
    fontWeight: '700',
  },
  stopTitle: {
    ...Type.headline,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
    color: Palette.forest900,
  },
  stopSubtitle: {
    ...Type.caption,
    color: Colors.light.textSecondary,
  },
  stopArrowContainer: {
    padding: 4,
  },
  stopBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one + 2,
  },
  aiTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Palette.forest100,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  aiTagText: {
    ...Type.caption,
    fontSize: 10,
    color: Palette.forest700,
    fontWeight: '600',
  },
  stopReasonText: {
    ...Type.body,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.light.textSecondary,
  },

  /* Travel Leg Connector */
  travelLegRow: {
    position: 'relative',
    paddingVertical: Spacing.one,
    paddingBottom: Spacing.two,
  },
  travelRailLine: {
    position: 'absolute',
    left: -Spacing.four + 4,
    top: 0,
    bottom: 0,
    width: 2,
    borderLeftWidth: 2,
    borderStyle: 'dashed',
    borderColor: Palette.mist200,
  },
  travelLegPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Palette.parchment100,
    borderWidth: 1,
    borderColor: Palette.mist200,
    paddingHorizontal: Spacing.three,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  travelLegDuration: {
    ...Type.caption,
    fontSize: 11,
    fontWeight: '700',
    color: Palette.forest700,
  },
  travelLegDot: {
    width: 4,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.textDisabled,
  },
  travelLegDistance: {
    ...Type.caption,
    fontSize: 11,
    color: Colors.light.textSecondary,
  },
  travelLegMode: {
    ...Type.caption,
    fontSize: 11,
    color: Colors.light.textDisabled,
  },

  /* 7. Unscheduled & Tips */
  unscheduledSection: {
    gap: Spacing.two,
  },
  sectionHeaderTitle: {
    ...Type.headline,
    color: Palette.forest900,
  },
  unscheduledCard: {
    gap: 2,
    padding: Spacing.three,
    borderRadius: Radius.md,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Palette.mist200,
  },
  unscheduledName: {
    ...Type.headline,
    color: Palette.forest900,
  },
  meta: { ...Type.subhead, color: Colors.light.textSecondary },
  aiTipsButtonWrap: {
    position: 'absolute',
    right: Spacing.four,
    zIndex: 50,
  },
  aiTipsButton: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Palette.forest900,
    borderWidth: 1,
    borderColor: Palette.forest700,
    ...Shadow.glass,
  },
  tipsModalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(22, 35, 29, 0.38)',
  },
  tipsModalCard: {
    maxHeight: '78%',
    paddingTop: Spacing.four,
    paddingHorizontal: Spacing.four,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    backgroundColor: Palette.parchment50,
    ...Shadow.glass,
  },
  tipsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingBottom: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.parchment300,
  },
  tipsModalTitleGroup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  tipsModalIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Palette.forest100,
  },
  tipsModalEyebrow: {
    ...Type.caption,
    fontSize: 9,
    letterSpacing: 1,
    color: Palette.terracotta700,
  },
  tipsCloseButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Palette.parchment200,
  },
  tipsModalList: { gap: Spacing.three, paddingTop: Spacing.four, paddingBottom: Spacing.two },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  tipBullet: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Palette.forest100,
  },
  tipBulletText: { ...Type.caption, fontSize: 11, color: Palette.forest700 },
  tipsTitle: {
    ...Type.headline,
    color: Palette.forest900,
  },
  tipItem: {
    ...Type.body,
    fontSize: 13,
    lineHeight: 18,
    color: Palette.forest900,
    flex: 1,
  },
  tipDisclaimer: {
    ...Type.caption,
    fontSize: 10,
    color: Palette.forest700,
    marginTop: Spacing.one,
  },
  deleteBtn: { alignSelf: 'center', marginTop: Spacing.two },
});
