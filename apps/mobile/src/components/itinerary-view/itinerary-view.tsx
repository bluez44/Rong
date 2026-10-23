import type { Itinerary, ItineraryItem, ItineraryWarning, RegionWeather } from '@rong/shared-types';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { DayWeatherBadge } from '@/components/day-weather-badge';
import { viewStyles as styles } from '@/components/itinerary-view/styles';
import { PlaceNotesSheet } from '@/components/place-notes-sheet';
import { ThemedText } from '@/components/themed-text';
import { ApproximateLocation } from '@/components/ui/approximate-location';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { CATEGORY_LABELS } from '@/constants/places';
import { notesSummary } from '@/lib/place-notes';
import { Colors, Palette, Spacing } from '@/constants/theme';
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

/** Phần lịch trình dùng chung cho lịch trình đã lưu và bản nháp gợi ý. */
type ItineraryViewData = Pick<
  Itinerary,
  'input' | 'days' | 'unscheduled' | 'warnings' | 'tips' | 'planner'
>;

type ItineraryStickyHeaderProps = {
  itinerary: ItineraryViewData;
  regionName?: string;
  /** Nhãn cạnh tên điểm đến. Mặc định "Chuyến đi". */
  badge?: string;
  selectedDayIndex: number;
  onSelectDay: (index: number) => void;
};

/** Phần đầu cố định của chế độ xem: tên, ngày đi, badges và tab chuyển ngày. */
export function ItineraryStickyHeader({ itinerary, regionName, badge, selectedDayIndex, onSelectDay }: ItineraryStickyHeaderProps) {
  const { input } = itinerary;
  const people = [`${input.adults} người lớn`, input.children ? `${input.children} trẻ em` : null]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.stickyHeader}>
      <View style={styles.destinationHeader}>
        <View style={styles.titleRow}>
          <ThemedText type="display" style={styles.destinationTitle}>
            {regionName ?? 'Lịch trình'}
          </ThemedText>
          <View style={styles.destinationBadge}>
            <View style={styles.badgePulseDot} />
            <Text style={styles.destinationBadgeText} numberOfLines={1}>
              {badge ?? 'Chuyến đi'}
            </Text>
          </View>
        </View>

        <Text style={styles.tripDateRow}>
          {formatDateRange(input.startsAt, input.endsAt)} · {itinerary.days.length} ngày
        </Text>

        <View style={styles.tripTagList}>
          <View style={styles.tripTag}>
            <Text style={styles.tripTagText} numberOfLines={1}>
              {TRAVEL_PARTY_LABELS[input.travelParty]} • {people}
            </Text>
          </View>
          <View style={styles.tripTag}>
            <Text style={styles.tripTagText} numberOfLines={1}>
              {BUDGET_LABELS[input.budgetTier]}
            </Text>
          </View>
          <View style={[styles.tripTag, styles.tripTagAccent]}>
            <Icon name="sparkles" size={12} color={Palette.forest700} />
            <Text style={[styles.tripTagText, styles.tripTagAccentText]} numberOfLines={1}>
              {PLANNER_LABELS[itinerary.planner]}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.dayNavScroll}
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
    </View>
  );
}

type ItineraryViewBodyProps = {
  itinerary: ItineraryViewData;
  regionName?: string;
  selectedDayIndex: number;
  onOpenDayMap: (dayIndex: number) => void;
  /** Không có thì ẩn lối vào chế độ sửa (người chỉ xem, bản nháp). */
  onStartEdit?: () => void;
  /** Vẽ cuối danh sách (nút xóa lịch trình). */
  footer?: ReactNode;
  /** Người tạo lịch trình: sửa được ghi chú của từng điểm (một bản với "Muốn đi"). */
  notesEditable?: boolean;
  /** Sau khi sửa ghi chú: tải lại lịch trình để thấy ghi chú mới. */
  onNotesSaved?: () => void;
  /** Thời tiết các ngày của chuyến (chỉ lịch trình đã lưu); không có thì giữ badge "Lộ trình chính". */
  weather?: RegionWeather | null;
};

export function ItineraryViewBody({
  itinerary,
  regionName,
  selectedDayIndex,
  onOpenDayMap,
  onStartEdit,
  footer,
  notesEditable,
  onNotesSaved,
  weather,
}: ItineraryViewBodyProps) {
  const [notesFor, setNotesFor] = useState<ItineraryItem | null>(null);
  const currentDay = itinerary.days[selectedDayIndex] ?? itinerary.days[0];
  const dayWeather = currentDay ? weather?.days.find((d) => d.date === currentDay.date) : undefined;
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
            accessibilityLabel={currentDay ? `Xem bản đồ ngày ${selectedDayIndex + 1}` : 'Xem bản đồ'}
            disabled={!currentDay}
            onPress={() => onOpenDayMap(selectedDayIndex)}
            style={styles.viewMapBtn}>
            <Text numberOfLines={1} style={styles.viewMapBtnText}>Bản đồ</Text>
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
          {onStartEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tự tay sắp xếp lại"
              onPress={onStartEdit}
              style={styles.reorderLink}>
              <Text numberOfLines={1} style={styles.reorderLinkText}>Tự tay sắp xếp lại</Text>
              <Icon name="forward" size={14} color={Palette.forest700} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* 4. Selected day */}
      <View style={styles.dayNavSection}>
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
            {dayWeather ? (
              <DayWeatherBadge day={dayWeather} />
            ) : (
              <View style={styles.dayFocusBadge}>
                <Text style={styles.dayFocusText}>Lộ trình chính</Text>
              </View>
            )}
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
              <TimelineItemCard
                item={item}
                stopIndex={idx + 1}
                onEditNotes={notesEditable ? setNotesFor : undefined}
              />
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

      {footer}
      {notesFor?.placeId ? (
        <PlaceNotesSheet
          visible
          placeId={notesFor.placeId}
          placeName={notesFor.place?.name ?? 'Địa điểm'}
          notes={notesFor.place?.notes ?? null}
          onClose={() => setNotesFor(null)}
          onSaved={() => onNotesSaved?.()}
        />
      ) : null}
    </>
  );
}

export function AiTipsAccess({ tips }: { tips: string[] }) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const pulse = useSharedValue(1);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }] }));

  useEffect(() => {
    pulse.set(
      withRepeat(
        withTiming(1.06, { duration: 1100, reduceMotion: ReduceMotion.System }),
        -1,
        true,
        undefined,
        ReduceMotion.System,
      ),
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

      <BottomSheet
        visible={visible}
        onClose={() => setVisible(false)}
        style={styles.tipsSheet}
        header={
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
        }>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.tipsModalList}>
          {tips.map((tip, index) => (
            <View key={`${index}-${tip}`} style={styles.tipRow}>
              <View style={styles.tipBullet}><Text style={styles.tipBulletText}>{index + 1}</Text></View>
              <Text style={styles.tipItem}>{tip}</Text>
            </View>
          ))}
          <Text style={styles.tipDisclaimer}>Gợi ý từ Rong AI, hãy kiểm tra lại trước khi khởi hành.</Text>
        </ScrollView>
      </BottomSheet>
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

/**
 * Một điểm trong lịch trình. `onEditNotes` có khi người xem là người tạo; không có thì mở chi tiết kèm ghi chú của
 * người tạo (chỉ đọc).
 */
export function TimelineItemCard({
  item,
  stopIndex,
  onEditNotes,
}: {
  item: ItineraryItem;
  stopIndex: number;
  onEditNotes?: (item: ItineraryItem) => void;
}) {
  const notes = item.place?.notes ?? null;
  const summary = notesSummary(notes);
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
              {item.place?.address ? <Text style={styles.stopAddress}>{item.place.address}</Text> : null}
              {notes?.note ? (
                <Text style={styles.stopNote} numberOfLines={2}>
                  {notes.note}
                </Text>
              ) : null}
              {summary ? <Text style={styles.stopAddress}>{summary}</Text> : null}
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
        {onEditNotes && item.placeId && item.kind !== 'rest' ? (
          <Button
            label={notes ? 'Sửa ghi chú' : 'Thêm ghi chú'}
            variant="plain"
            size="sm"
            onPress={() => onEditNotes(item)}
            style={styles.notesAction}
          />
        ) : null}
      </View>
    </View>
  );

  if (!canOpen) return cardContent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Mở chi tiết địa điểm"
      onPress={() =>
        router.push({
          pathname: '/place/[id]',
          params: {
            id: item.placeId!,
            name: title,
            // Lịch trình của người khác: chi tiết hiện ghi chú của người tạo, chỉ đọc.
            ...(!onEditNotes && notes && { ownerNotes: JSON.stringify(notes) }),
          },
        })
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
