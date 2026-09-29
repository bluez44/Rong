import type { Itinerary, ItineraryDay, ItineraryItem, PlaceAlternative, PlaceCategory } from '@rong/shared-types';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { NestedReorderableList, useReorderableDrag } from 'react-native-reorderable-list';

import { useAuth } from '@/auth/auth-context';
import { ActionSheet, type SheetAction } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Icon, type IconName } from '@/components/ui/icon';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';
import { useRegionPlaces } from '@/hooks/use-region-places';
import { ApiError } from '@/lib/api';
import {
  addPlace,
  dropUnscheduled,
  durationOf,
  moveToDay,
  removeItem,
  reorder,
  replacePlace,
  setTiming,
  shiftClock,
  unschedule,
  type EditPlace,
} from '@/lib/itinerary-edit';
import { useSavedPlaces } from '@/lib/saved-places';
import { formatDuration, formatPlanDate, formatTime, MEAL_LABELS } from '@/lib/trip-format';

type Apply = (edit: (itinerary: Itinerary) => Itinerary) => void;

type Sheet =
  | { type: 'item'; itemId: string }
  | { type: 'move'; itemId: string }
  | { type: 'timing'; itemId: string }
  | { type: 'swap'; itemId: string }
  | { type: 'add'; day: number }
  | { type: 'tray'; placeId: string }
  | { type: 'trayDay'; placeId: string }
  | null;

type EditorProps = {
  itinerary: Itinerary;
  apply: Apply;
  regionName: string;
};

/**
 * Chế độ sửa lịch trình (F8): giữ và kéo biểu tượng ≡ để đổi thứ tự trong ngày
 * (FR-8.1), chạm một mục để chuyển ngày, đổi giờ/thời lượng, đổi điểm tương tự
 * hoặc xóa; mỗi ngày có nút thêm địa điểm (FR-8.2). Phải nằm trong
 * `ScrollViewContainer` của react-native-reorderable-list.
 */
export function ItineraryEditor({ itinerary, apply, regionName }: EditorProps) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const close = () => setSheet(null);

  return (
    <>
      {itinerary.days.map((day, index) => (
        <EditableDay
          key={day.id}
          day={day}
          index={index}
          itinerary={itinerary}
          onReorder={(from, to) => apply((it) => reorder(it, index, from, to))}
          onOpenItem={(itemId) => setSheet({ type: 'item', itemId })}
          onAdd={() => setSheet({ type: 'add', day: index })}
        />
      ))}

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Chưa xếp
        </Text>
        {itinerary.unscheduled.length === 0 ? (
          <Text style={styles.hint}>Điểm bạn tạm bỏ khỏi ngày sẽ nằm ở đây để xếp lại sau.</Text>
        ) : null}
        {itinerary.unscheduled.map((u) => (
          <Pressable
            key={u.placeId}
            accessibilityRole="button"
            accessibilityHint="Mở lựa chọn cho điểm chưa xếp"
            onPress={() => setSheet({ type: 'tray', placeId: u.placeId })}
            style={({ pressed }) => [styles.tray, pressed && styles.pressed]}>
            <View style={styles.flex}>
              <Text style={styles.itemName}>{u.name ?? 'Địa điểm đã chọn'}</Text>
              <Text style={styles.meta}>{u.reason}</Text>
            </View>
            <Icon name="more" size={18} />
          </Pressable>
        ))}
      </View>

      <EditorSheet sheet={sheet} setSheet={setSheet} close={close} itinerary={itinerary} apply={apply} regionName={regionName} />
    </>
  );
}

type EditableDayProps = {
  day: ItineraryDay;
  index: number;
  itinerary: Itinerary;
  onReorder: (from: number, to: number) => void;
  onOpenItem: (itemId: string) => void;
  onAdd: () => void;
};

function EditableDay({ day, index, itinerary, onReorder, onOpenItem, onAdd }: EditableDayProps) {
  const dayWarnings = itinerary.warnings.filter((w) => w.dayId === day.id && !w.itemId);
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
      {dayWarnings.map((w) => (
        <WarningLine key={w.message} message={w.message} />
      ))}
      <NestedReorderableList
        data={day.items}
        keyExtractor={(item) => item.id}
        onReorder={({ from, to }) => onReorder(from, to)}
        renderItem={({ item }) => (
          <EditItemRow
            item={item}
            warnings={itinerary.warnings.filter((w) => w.itemId === item.id).map((w) => w.message)}
            onOpen={() => onOpenItem(item.id)}
          />
        )}
        ItemSeparatorComponent={Separator}
        ListEmptyComponent={<Text style={styles.hint}>Chưa có hoạt động nào trong ngày này.</Text>}
      />
      <Button label="Thêm địa điểm" variant="plain" size="sm" onPress={onAdd} style={styles.inlineAction} accessibilityLabel={`Thêm địa điểm vào ngày ${index + 1}`} />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

function EditItemRow({ item, warnings, onOpen }: { item: ItineraryItem; warnings: string[]; onOpen: () => void }) {
  const drag = useReorderableDrag();
  const title = itemTitle(item);
  const minutes = durationOf(item);
  const time = `${formatTime(item.startsAt)}–${formatTime(item.endsAt)}`;

  return (
    <View style={styles.item}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Giữ và kéo để đổi thứ tự: ${title}`}
        onLongPress={drag}
        delayLongPress={150}
        hitSlop={8}
        style={styles.handle}>
        <Icon name="drag" size={20} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${time}, ${formatDuration(minutes)}${item.fixedStart ? ', giờ đã ghim' : ''}`}
        accessibilityHint="Mở lựa chọn chỉnh sửa"
        onPress={onOpen}
        style={({ pressed }) => [styles.itemBody, pressed && styles.pressed]}>
        <View style={styles.flex}>
          {item.travelMinutesFromPrevious ? (
            <Text style={styles.leg}>Đi {formatDuration(item.travelMinutesFromPrevious)}</Text>
          ) : null}
          <Text style={styles.time}>
            {time}
            {item.fixedStart ? ' · ghim giờ' : ''}
          </Text>
          <Text style={styles.itemName} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.meta}>
            {itemKind(item)} · {formatDuration(minutes)}
          </Text>
          {warnings.map((message) => (
            <WarningLine key={message} message={message} />
          ))}
        </View>
        <Icon name="more" size={18} />
      </Pressable>
    </View>
  );
}

function WarningLine({ message }: { message: string }) {
  return (
    <View style={styles.warning}>
      <Icon name="warning" size={14} color={Colors.light.warning} />
      <Text style={[styles.warningText, styles.flex]}>{message}</Text>
    </View>
  );
}

type EditorSheetProps = EditorProps & {
  sheet: Sheet;
  setSheet: (sheet: Sheet) => void;
  close: () => void;
};

/** Một Modal duy nhất đổi nội dung theo bước, để chuyển giữa các bảng không bị iOS chặn. */
function EditorSheet({ sheet, setSheet, close, itinerary, apply, regionName }: EditorSheetProps) {
  const item = sheet && 'itemId' in sheet ? findItem(itinerary, sheet.itemId) : null;
  const tray = sheet && 'placeId' in sheet ? itinerary.unscheduled.find((u) => u.placeId === sheet.placeId) : null;
  const dayChoices = (onPick: (day: number) => void, skip?: number): SheetAction[] =>
    itinerary.days.flatMap((d, i) =>
      i === skip ? [] : [{ label: `Ngày ${i + 1}`, detail: formatPlanDate(d.date), icon: 'calendar' as const, onPress: () => onPick(i) }],
    );

  let title: string | undefined;
  let actions: SheetAction[] = [];
  let content = null;

  if (sheet?.type === 'item' && item) {
    title = itemTitle(item);
    const at = itinerary.days.findIndex((d) => d.items.some((i) => i.id === item.id));
    actions = [
      { label: 'Đổi giờ và thời lượng', icon: 'clock', onPress: () => setSheet({ type: 'timing', itemId: item.id }) },
      ...(itinerary.days.length > 1
        ? [{ label: 'Chuyển sang ngày khác', icon: 'calendar' as const, onPress: () => setSheet({ type: 'move', itemId: item.id }) }]
        : []),
      ...(item.placeId && item.kind !== 'rest'
        ? [
            { label: 'Đổi điểm tương tự', icon: 'swap' as const, onPress: () => setSheet({ type: 'swap', itemId: item.id }) },
            {
              label: 'Xem chi tiết địa điểm',
              icon: 'forward' as const,
              onPress: () => router.push({ pathname: '/place/[id]', params: { id: item.placeId!, name: itemTitle(item) } }),
            },
            { label: 'Để vào "Chưa xếp"', icon: 'tray' as const, onPress: () => apply((it) => unschedule(it, item.id)) },
          ]
        : []),
      { label: 'Xóa khỏi lịch trình', icon: 'trash', destructive: true, onPress: () => apply((it) => removeItem(it, item.id)) },
    ];
    if (at < 0) actions = [];
  } else if (sheet?.type === 'move' && item) {
    title = `Chuyển "${itemTitle(item)}" sang`;
    const at = itinerary.days.findIndex((d) => d.items.some((i) => i.id === item.id));
    actions = dayChoices((day) => apply((it) => moveToDay(it, item.id, day)), at);
  } else if (sheet?.type === 'timing' && item) {
    title = itemTitle(item);
    content = <TimingEditor key={item.id} item={item} onSave={(minutes, start) => { apply((it) => setTiming(it, item.id, minutes, start)); close(); }} />;
  } else if (sheet?.type === 'swap' && item?.placeId) {
    title = `Đổi "${itemTitle(item)}"`;
    content = (
      <Alternatives
        itineraryId={itinerary.id}
        placeId={item.placeId}
        onPick={(place) => {
          apply((it) => replacePlace(it, item.id, place));
          close();
        }}
      />
    );
  } else if (sheet?.type === 'add') {
    title = `Thêm vào ngày ${sheet.day + 1}`;
    content = (
      <AddPlace
        itinerary={itinerary}
        regionName={regionName}
        onPick={(place) => {
          apply((it) => addPlace(it, sheet.day, place));
          close();
        }}
      />
    );
  } else if (sheet?.type === 'tray' && tray) {
    title = tray.name ?? 'Địa điểm đã chọn';
    actions = [
      { label: 'Xếp vào một ngày', icon: 'calendar', onPress: () => setSheet({ type: 'trayDay', placeId: tray.placeId }) },
      {
        label: 'Xem chi tiết địa điểm',
        icon: 'forward',
        onPress: () => router.push({ pathname: '/place/[id]', params: { id: tray.placeId, ...(tray.name && { name: tray.name }) } }),
      },
      { label: 'Bỏ khỏi chuyến đi', icon: 'trash', destructive: true, onPress: () => apply((it) => dropUnscheduled(it, tray.placeId)) },
    ];
  } else if (sheet?.type === 'trayDay' && tray) {
    title = `Xếp "${tray.name ?? 'địa điểm'}" vào`;
    const place = placeOfTray(itinerary, tray.placeId, tray.name);
    actions = dayChoices((day) => apply((it) => addPlace(it, day, place)));
  }

  return (
    <ActionSheet visible={sheet !== null && (actions.length > 0 || content !== null)} title={title} actions={actions} onClose={close}>
      {content}
    </ActionSheet>
  );
}

const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240];

/** FR-8.4: thời lượng và giờ bắt đầu (ghim) của một mục. */
function TimingEditor({ item, onSave }: { item: ItineraryItem; onSave: (minutes: number, startTime: string | null) => void }) {
  const current = durationOf(item);
  const [minutes, setMinutes] = useState(current);
  const [pinned, setPinned] = useState(!!item.fixedStart);
  const [start, setStart] = useState(formatTime(item.startsAt));
  const options = DURATIONS.includes(current) ? DURATIONS : [...DURATIONS, current].sort((a, b) => a - b);

  return (
    <View style={styles.timing}>
      <Text style={styles.subLabel}>Thời lượng</Text>
      <View style={styles.chips}>
        {options.map((m) => (
          <Chip key={m} label={formatDuration(m)} selected={m === minutes} onPress={() => setMinutes(m)} />
        ))}
      </View>
      <Text style={styles.subLabel}>Giờ bắt đầu</Text>
      <View style={styles.chips}>
        <Chip label="Nối tiếp điểm trước" selected={!pinned} onPress={() => setPinned(false)} />
        <Chip label="Đặt giờ" selected={pinned} onPress={() => setPinned(true)} />
      </View>
      {pinned ? (
        <View style={styles.clockRow}>
          <ClockButton icon="remove" label="Sớm hơn 15 phút" onPress={() => setStart((s) => shiftClock(s, -15))} />
          <Text style={styles.clock} accessibilityLiveRegion="polite">
            {start}
          </Text>
          <ClockButton icon="add" label="Muộn hơn 15 phút" onPress={() => setStart((s) => shiftClock(s, 15))} />
        </View>
      ) : null}
      <Text style={styles.hint}>Giờ các điểm phía sau được tính lại sau khi lưu.</Text>
      <Button label="Lưu" onPress={() => onSave(minutes, pinned ? start : null)} />
    </View>
  );
}

function ClockButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.clockButton, pressed && styles.pressed]}>
      <Icon name={icon} size={18} color={Colors.light.primary} />
    </Pressable>
  );
}

/** FR-8.3: ba điểm cùng loại, ở gần, chưa có trong lịch trình. */
function Alternatives({ itineraryId, placeId, onPick }: { itineraryId: string; placeId: string; onPick: (place: EditPlace) => void }) {
  const { authFetch } = useAuth();
  const [state, setState] = useState<{ items: PlaceAlternative[] | null; error: string | null }>({ items: null, error: null });

  useEffect(() => {
    let active = true;
    authFetch<PlaceAlternative[]>(`/itineraries/${itineraryId}/alternatives?placeId=${placeId}`)
      .then((items) => active && setState({ items, error: null }))
      .catch((e) => active && setState({ items: [], error: e instanceof ApiError ? e.message : 'Chưa tải được gợi ý.' }));
    return () => {
      active = false;
    };
  }, [authFetch, itineraryId, placeId]);

  if (!state.items) return <ActivityIndicator color={Colors.light.primary} style={styles.loading} />;
  if (state.error) return <Text style={styles.hint}>{state.error}</Text>;
  if (state.items.length === 0) return <Text style={styles.hint}>Không tìm thấy điểm cùng loại nào gần đó.</Text>;
  return (
    <View style={styles.options}>
      {state.items.map((alt) => (
        <PlaceOption
          key={alt.id}
          name={alt.name}
          category={alt.category}
          detail={[`cách ${alt.distanceKm.toLocaleString('vi-VN')} km`, alt.description].filter(Boolean).join(' · ')}
          onPress={() => onPick(alt)}
        />
      ))}
    </View>
  );
}

type Source = 'tray' | 'saved' | 'region';

/** FR-8.2: thêm từ "Chưa xếp", "Muốn đi" của vùng này, hoặc danh mục của vùng. */
function AddPlace({ itinerary, regionName, onPick }: { itinerary: Itinerary; regionName: string; onPick: (place: EditPlace) => void }) {
  const saved = useSavedPlaces();
  const inTrip = new Set(itinerary.days.flatMap((d) => d.items.flatMap((i) => (i.placeId ? [i.placeId] : []))));
  const savedHere = saved.items.filter((s) => s.regionId === itinerary.regionId && !inTrip.has(s.placeId));
  const [source, setSource] = useState<Source>(
    itinerary.unscheduled.length ? 'tray' : savedHere.length ? 'saved' : 'region',
  );

  return (
    <View style={styles.options}>
      <View style={styles.chips}>
        <Chip label={`Chưa xếp · ${itinerary.unscheduled.length}`} selected={source === 'tray'} onPress={() => setSource('tray')} />
        <Chip label={`Muốn đi · ${savedHere.length}`} selected={source === 'saved'} onPress={() => setSource('saved')} />
        <Chip label="Trong vùng" selected={source === 'region'} onPress={() => setSource('region')} />
      </View>
      {source === 'tray'
        ? listOrEmpty(
            itinerary.unscheduled.map((u) => {
              const place = placeOfTray(itinerary, u.placeId, u.name);
              return <PlaceOption key={u.placeId} name={place.name} category={place.category} detail={u.reason} onPress={() => onPick(place)} />;
            }),
            'Không có điểm nào đang chờ xếp.',
          )
        : null}
      {source === 'saved'
        ? listOrEmpty(
            savedHere.map((s) => (
              <PlaceOption
                key={s.placeId}
                name={s.name}
                category={s.category}
                onPress={() => onPick({ id: s.placeId, name: s.name, category: s.category })}
              />
            )),
            `Chưa lưu địa điểm nào ở ${regionName} vào "Muốn đi".`,
          )
        : null}
      {source === 'region' ? <RegionOptions regionId={itinerary.regionId} exclude={inTrip} onPick={onPick} /> : null}
    </View>
  );
}

function RegionOptions({ regionId, exclude, onPick }: { regionId: string; exclude: Set<string>; onPick: (place: EditPlace) => void }) {
  const places = useRegionPlaces(regionId, NO_FILTER, 'v1');
  const items = places.items.filter((p): p is typeof p & { id: string } => !!p.id && !exclude.has(p.id));

  if (places.status === 'loading') return <ActivityIndicator color={Colors.light.primary} style={styles.loading} />;
  if (places.status === 'error' && places.error && items.length === 0) return <Text style={styles.hint}>{places.error.message}</Text>;
  return (
    <>
      {listOrEmpty(
        items.map((p) => (
          <PlaceOption key={p.id} name={p.name} category={p.category} detail={p.description ?? undefined} onPress={() => onPick(p)} />
        )),
        'Chưa có địa điểm nào trong danh mục của vùng này.',
      )}
      {places.nextCursor ? (
        <Button label="Xem thêm" variant="plain" size="sm" loading={places.status === 'loadingMore'} onPress={places.loadMore} />
      ) : null}
    </>
  );
}

const NO_FILTER: PlaceCategory[] = [];

function listOrEmpty(nodes: React.ReactNode[], empty: string) {
  return nodes.length ? nodes : <Text style={styles.hint}>{empty}</Text>;
}

function PlaceOption({ name, category, detail, onPress }: { name: string; category: PlaceCategory; detail?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${CATEGORY_LABELS[category]}`}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
      <View style={styles.optionIcon}>
        <Icon name={category} size={18} color={Colors.light.primary} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.itemName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.meta} numberOfLines={2}>
          {detail ?? CATEGORY_LABELS[category]}
        </Text>
      </View>
      <Icon name="add" size={18} color={Colors.light.primary} />
    </Pressable>
  );
}

function findItem(itinerary: Itinerary, itemId: string): ItineraryItem | null {
  for (const day of itinerary.days) {
    const item = day.items.find((i) => i.id === itemId);
    if (item) return item;
  }
  return null;
}

/** "Chưa xếp" không lưu danh mục; lấy từ mục cùng địa điểm nếu có, không thì coi là điểm tham quan. */
function placeOfTray(itinerary: Itinerary, placeId: string, name?: string): EditPlace {
  const known = itinerary.days.flatMap((d) => d.items).find((i) => i.placeId === placeId)?.place;
  const category = (known?.category as PlaceCategory | undefined) ?? 'check_in';
  return { id: placeId, name: name ?? known?.name ?? 'Địa điểm đã chọn', category };
}

export function itemTitle(item: ItineraryItem): string {
  return item.place?.name ?? (item.kind === 'rest' ? 'Nghỉ ngơi' : 'Hoạt động');
}

function itemKind(item: ItineraryItem): string {
  if (item.kind === 'meal') return item.mealType ? MEAL_LABELS[item.mealType] : 'Ăn uống';
  if (item.kind === 'rest') return 'Nghỉ ngơi';
  return CATEGORY_LABELS[item.place?.category as PlaceCategory] ?? 'Tham quan';
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: Spacing.three },
  sectionTitle: { ...Type.headline, color: Colors.light.text },
  dayTitle: { ...Type.title2, color: Colors.light.text },
  meta: { ...Type.subhead, color: Colors.light.textSecondary },
  hint: { ...Type.footnote, color: Colors.light.textSecondary },
  subLabel: { ...Type.subhead, fontFamily: Type.headline.fontFamily, color: Colors.light.text },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
  loading: { paddingVertical: Spacing.four },
  pressed: { opacity: 0.7 },
  separator: { height: Spacing.two },
  item: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
  },
  handle: { width: MinTouch, alignItems: 'center', justifyContent: 'center' },
  itemBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three, paddingRight: Spacing.three },
  leg: { ...Type.caption, color: Colors.light.textSecondary },
  time: { ...Type.numeric, color: Colors.light.primary },
  itemName: { ...Type.headline, color: Colors.light.text },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one, marginTop: Spacing.one },
  warningText: { ...Type.footnote, color: Colors.light.warning },
  tray: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.light.hairline,
  },
  timing: { gap: Spacing.three, paddingTop: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  clockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.five },
  clock: { ...Type.title2, color: Colors.light.text, fontVariant: ['tabular-nums'] },
  clockButton: {
    width: MinTouch,
    height: MinTouch,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.backgroundSelected,
  },
  options: { gap: Spacing.two, paddingTop: Spacing.two },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, borderRadius: Radius.md },
  optionIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.backgroundSelected,
  },
});
