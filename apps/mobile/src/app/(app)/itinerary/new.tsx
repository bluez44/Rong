import type { BudgetTier, Itinerary, ItineraryInput, Pace, PlaceCategory, Transport, TravelParty } from '@rong/shared-types';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-context';
import { Glass } from '@/components/glass';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DateTimeField } from '@/components/ui/date-time-field';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { Stepper } from '@/components/ui/stepper';
import { TextField } from '@/components/ui/text-field';
import { CATEGORIES, CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';
import { useRegionPlaces } from '@/hooks/use-region-places';
import { ApiError } from '@/lib/api';
import { tripDraft, useTripDraft, type DraftPlace } from '@/lib/trip-draft';
import { BUDGET_LABELS, PACE_LABELS, TRANSPORT_LABELS, TRAVEL_PARTY_LABELS } from '@/lib/trip-format';

type Params = { regionId: string; regionName?: string };

/** Độ dài tối đa một chuyến trong MVP (PRD F6), khớp MAX_TRIP_DAYS của backend. */
const MAX_TRIP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const PARTIES = Object.keys(TRAVEL_PARTY_LABELS) as TravelParty[];
const BUDGETS = Object.keys(BUDGET_LABELS) as BudgetTier[];
const PACES = Object.keys(PACE_LABELS) as Pace[];
const TRANSPORTS = Object.keys(TRANSPORT_LABELS) as Transport[];
// Lưu trú có trường riêng; không phải sở thích tham quan.
const INTERESTS = CATEGORIES.filter((c) => c !== 'stay');

/** Body của POST /itineraries: nhịp độ bỏ trống thì backend lấy theo nhóm đi. */
type CreateBody = Omit<ItineraryInput, 'pace'> & { pace?: Pace };

/** Tạo lịch trình (F6): thông tin chuyến đi → AI sắp xếp → mở lịch trình. */
export default function NewItineraryScreen() {
  const { regionId, regionName = 'Vùng đã chọn' } = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const { authFetch } = useAuth();
  const draft = useTripDraft(regionId);

  // Cố định mốc "bây giờ" để picker gốc không nhận khoảng chọn mới ở mỗi lần render.
  const [now] = useState(() => new Date());
  const [startsAt, setStartsAt] = useState(() => nextWeekend().start);
  const [endsAt, setEndsAt] = useState(() => nextWeekend().end);
  const [party, setParty] = useState<TravelParty | null>(null);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [needStay, setNeedStay] = useState(!!draft.accommodation);
  const [allowAi, setAllowAi] = useState(true);
  const [budget, setBudget] = useState<BudgetTier>('moderate');
  const [pace, setPace] = useState<Pace | null>(null);
  const [transport, setTransport] = useState<Transport | null>(null);
  const [interests, setInterests] = useState<PlaceCategory[]>([]);
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState<'ai' | 'manual'>('ai');

  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const dateError = validateDates(startsAt, endsAt);
  const partyError = party ? null : 'Chọn ai đi cùng để app xếp nhịp độ phù hợp.';
  const stayError = needStay && !draft.accommodation ? 'Chọn một nơi lưu trú, hoặc chọn "Không cần".' : null;
  const valid = !dateError && !partyError && !stayError;

  const submit = async () => {
    setShowErrors(true);
    setError(null);
    if (!valid || !party) return;

    const body: CreateBody = {
      regionId,
      planningMode: mode,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      travelParty: party,
      adults,
      children,
      selectedPlaceIds: draft.places.map((p) => p.id),
      accommodationPlaceId: needStay ? draft.accommodation?.id : null,
      allowAiSuggestions: allowAi,
      budgetTier: budget,
      ...(pace && { pace }),
      transport,
      preferredCategories: interests,
      notes: notes.trim() || null,
    };

    setSubmitting(true);
    try {
      const itinerary = await authFetch<Itinerary>('/itineraries', { method: 'POST', body });
      tripDraft.clear();
      // Thay form bằng lịch trình: quay lại từ lịch trình là về bản đồ vùng.
      // Tự sắp xếp: các ngày còn trống, mở thẳng chế độ sửa (F8).
      router.replace({ pathname: '/itinerary/[id]', params: { id: itinerary.id, regionName, ...(mode === 'manual' && { edit: '1' }) } });
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.'));
      setSubmitting(false);
    }
  };

  const toggleInterest = (c: PlaceCategory) =>
    setInterests((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  return (
    <Screen edges={['top']}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => router.back()} disabled={submitting}>
          <Glass shape="circle" interactive style={styles.backGlass}>
            <Icon name="back" color={Colors.light.text} />
          </Glass>
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title} accessibilityRole="header">
            Lập lịch trình
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {regionName}
          </Text>
        </View>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.eight }]}>
        <Section title="Cách lập">
          <View style={styles.modes}>
            <ModeCard icon="sparkles" title="AI sắp xếp" body="Xếp theo ngày, buổi và gợi ý quán ăn." selected={mode === 'ai'} onPress={() => setMode('ai')} />
            <ModeCard
              icon="calendar"
              title="Tự sắp xếp"
              body="Tạo các ngày trống, bạn tự thêm và sắp điểm."
              selected={mode === 'manual'}
              onPress={() => setMode('manual')}
            />
          </View>
        </Section>

        <Section
          title="Địa điểm đã chọn"
          hint={
            draft.places.length
              ? mode === 'manual'
                ? 'Các điểm này nằm ở "Chưa xếp" để bạn đưa vào từng ngày.'
                : undefined
              : mode === 'manual'
                ? 'Chưa chọn địa điểm nào: bạn có thể thêm sau trong lịch trình.'
                : 'Chưa chọn địa điểm nào: AI sẽ tự chọn trong vùng này.'
          }>
          {draft.places.map((place) => (
            <SelectedPlace key={place.id} place={place} onRemove={() => tripDraft.togglePlace(regionId, place)} />
          ))}
          <Button label="Chọn thêm trên bản đồ" variant="plain" size="sm" onPress={() => router.back()} style={styles.inlineAction} />
        </Section>

        <Section title="Thời gian">
          <DateTimeField label="Bắt đầu" value={startsAt} onChange={setStartsAt} minimumDate={now} />
          <DateTimeField label="Kết thúc" value={endsAt} onChange={setEndsAt} minimumDate={startsAt} error={showErrors ? dateError : null} />
        </Section>

        <Section title="Ai đi" error={showErrors ? partyError : null}>
          <ChipGroup options={PARTIES} labels={TRAVEL_PARTY_LABELS} isSelected={(p) => p === party} onPress={setParty} />
          <Stepper label="Người lớn" value={adults} min={1} max={30} onChange={setAdults} />
          <Stepper label="Trẻ em" hint="Dưới 12 tuổi" value={children} min={0} max={30} onChange={setChildren} />
        </Section>

        <Section title="Lưu trú" error={showErrors ? stayError : null}>
          <ChipGroup
            options={['no', 'yes'] as const}
            labels={{ no: 'Không cần', yes: 'Cần' }}
            isSelected={(v) => (v === 'yes') === needStay}
            onPress={(v) => setNeedStay(v === 'yes')}
          />
          {needStay ? <StayPicker regionId={regionId} selected={draft.accommodation} /> : null}
        </Section>

        <Section title="Tùy chọn thêm">
          {/* Tự sắp xếp không có bước AI chọn điểm. */}
          {mode === 'ai' ? (
            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <Text style={styles.body}>Cho AI gợi ý thêm địa điểm</Text>
                <Text style={styles.hint}>Điểm do AI thêm có nhãn “AI gợi ý”.</Text>
              </View>
              <Switch
                value={allowAi}
                onValueChange={setAllowAi}
                trackColor={{ true: Colors.light.primary }}
                accessibilityLabel="Cho AI gợi ý thêm địa điểm"
              />
            </View>
          ) : null}
          <SubLabel>Ngân sách</SubLabel>
          <ChipGroup options={BUDGETS} labels={BUDGET_LABELS} isSelected={(b) => b === budget} onPress={setBudget} />
          <SubLabel hint="Để trống: theo nhóm đi">Nhịp độ</SubLabel>
          <ChipGroup options={PACES} labels={PACE_LABELS} isSelected={(p) => p === pace} onPress={(p) => setPace((cur) => (cur === p ? null : p))} />
          <SubLabel>Phương tiện</SubLabel>
          <ChipGroup
            options={TRANSPORTS}
            labels={TRANSPORT_LABELS}
            isSelected={(t) => t === transport}
            onPress={(t) => setTransport((cur) => (cur === t ? null : t))}
          />
          <SubLabel>Sở thích</SubLabel>
          <ChipGroup options={INTERESTS} labels={CATEGORY_LABELS} isSelected={(c) => interests.includes(c)} onPress={toggleInterest} icons />
          <TextField
            label="Ghi chú"
            placeholder="Ví dụ: muốn ngắm hoàng hôn, tránh leo dốc"
            value={notes}
            onChangeText={setNotes}
            maxLength={500}
            multiline
          />
        </Section>

        {error ? (
          <Notice tone={error.code === 'NOT_ENOUGH_PLACES' ? 'warning' : 'danger'} title="Chưa tạo được lịch trình">
            {error.message}
          </Notice>
        ) : null}
        {showErrors && !valid ? <Notice tone="danger" title="Còn thông tin chưa hợp lệ">Kiểm tra các mục được đánh dấu đỏ ở trên.</Notice> : null}
        {submitting ? <Notice tone="ai" title="AI đang sắp xếp lịch trình">Thường mất 10–20 giây. Đừng đóng màn hình này.</Notice> : null}

        <Button label="Tạo lịch trình" size="lg" loading={submitting} onPress={submit} />
      </ScrollView>
    </Screen>
  );
}

function Section({ title, hint, error, children }: { title: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function SubLabel({ children, hint }: { children: string; hint?: string }) {
  return (
    <Text style={styles.subLabel}>
      {children}
      {hint ? <Text style={styles.hint}>{`  ${hint}`}</Text> : null}
    </Text>
  );
}

function ChipGroup<T extends string>({
  options,
  labels,
  isSelected,
  onPress,
  icons,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  isSelected: (value: T) => boolean;
  onPress: (value: T) => void;
  /** Giá trị là danh mục địa điểm: hiện icon của danh mục. */
  icons?: boolean;
}) {
  return (
    <View style={styles.chips}>
      {options.map((o) => (
        <Chip key={o} label={labels[o]} icon={icons ? (o as PlaceCategory) : undefined} selected={isSelected(o)} onPress={() => onPress(o)} />
      ))}
    </View>
  );
}

function ModeCard({
  icon,
  title,
  body,
  selected,
  onPress,
}: {
  icon: 'sparkles' | 'calendar';
  title: string;
  body: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${body}`}
      onPress={onPress}
      style={[styles.mode, selected && styles.modeSelected]}>
      <Icon name={icon} size={20} color={Colors.light.ai} />
      <Text style={styles.modeTitle}>{title}</Text>
      <Text style={styles.hint}>{body}</Text>
    </Pressable>
  );
}

function SelectedPlace({ place, onRemove }: { place: DraftPlace; onRemove: () => void }) {
  return (
    <View style={styles.selected}>
      <Icon name={place.category} size={18} color={Colors.light.primary} />
      <Text style={[styles.body, styles.flex]} numberOfLines={1}>
        {place.name}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Bỏ ${place.name}`} hitSlop={10} onPress={onRemove}>
        <Icon name="close" size={16} />
      </Pressable>
    </View>
  );
}

const STAY_LIMIT = 8;

/** Chọn nơi lưu trú trong danh mục của vùng (chip "Lưu trú"), điểm cao nhất trước. */
function StayPicker({ regionId, selected }: { regionId: string; selected: DraftPlace | null }) {
  const stays = useRegionPlaces(regionId, STAY_ONLY);
  const [expanded, setExpanded] = useState(false);
  const options = stays.items.filter((p): p is typeof p & { id: string } => !!p.id);
  const visible = expanded ? options : options.slice(0, STAY_LIMIT);
  // Nơi ở chọn trên bản đồ có thể nằm ngoài trang đầu.
  const extra = selected && !options.some((p) => p.id === selected.id) ? [selected] : [];

  if (stays.status === 'loading') return <ActivityIndicator color={Colors.light.primary} style={styles.stayLoading} />;
  if (stays.status === 'error' && stays.error) {
    return (
      <Notice tone="danger" title="Chưa tải được nơi lưu trú" action={<Button label="Thử lại" variant="plain" size="sm" onPress={stays.retry} style={styles.inlineAction} />}>
        {stays.error.message}
      </Notice>
    );
  }
  if (options.length === 0 && extra.length === 0) {
    return <Text style={styles.hint}>Vùng này chưa có nơi lưu trú trong danh mục. Chọn “Không cần” để tiếp tục.</Text>;
  }

  return (
    <View accessibilityRole="radiogroup" style={styles.stays}>
      {[...extra, ...visible].map((p) => {
        const active = selected?.id === p.id;
        const item: DraftPlace = { id: p.id, name: p.name, category: 'stay' };
        return (
          <Pressable
            key={p.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => tripDraft.setAccommodation(regionId, active ? null : item)}
            style={({ pressed }) => [styles.stay, active && styles.stayActive, pressed && styles.pressed]}>
            <View style={[styles.radio, active && styles.radioActive]}>{active ? <View style={styles.radioDot} /> : null}</View>
            <Text style={[styles.body, styles.flex]} numberOfLines={1}>
              {p.name}
            </Text>
          </Pressable>
        );
      })}
      {!expanded && options.length > STAY_LIMIT ? (
        <Button label={`Xem thêm ${options.length - STAY_LIMIT} nơi`} variant="plain" size="sm" onPress={() => setExpanded(true)} style={styles.inlineAction} />
      ) : null}
    </View>
  );
}

const STAY_ONLY: PlaceCategory[] = ['stay'];

/** Mặc định: thứ Bảy tới 08:00 → Chủ nhật 20:00 (giờ máy). */
function nextWeekend(): { start: Date; end: Date } {
  const start = new Date();
  start.setDate(start.getDate() + (((6 - start.getDay() + 7) % 7) || 7));
  start.setHours(8, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setHours(20, 0, 0, 0);
  return { start, end };
}

function validateDates(start: Date, end: Date): string | null {
  if (end <= start) return 'Thời gian kết thúc phải sau thời gian bắt đầu.';
  if (end.getTime() - start.getTime() > MAX_TRIP_DAYS * DAY_MS) return `Chuyến đi tối đa ${MAX_TRIP_DAYS} ngày.`;
  return null;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  backGlass: { width: MinTouch, alignItems: 'center', justifyContent: 'center' },
  title: { ...Type.title2, color: Colors.light.text },
  subtitle: { ...Type.subhead, color: Colors.light.textSecondary },
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, gap: Spacing.six },
  section: { gap: Spacing.three },
  sectionTitle: { ...Type.headline, color: Colors.light.text },
  subLabel: { ...Type.subhead, color: Colors.light.text, marginTop: Spacing.two },
  body: { ...Type.callout, color: Colors.light.text },
  hint: { ...Type.footnote, color: Colors.light.textSecondary },
  error: { ...Type.footnote, color: Colors.light.danger },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  modes: { flexDirection: 'row', gap: Spacing.three },
  mode: {
    flex: 1,
    gap: Spacing.one,
    padding: Spacing.four,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    backgroundColor: Colors.light.surface,
  },
  modeSelected: { borderColor: Colors.light.ai, borderWidth: 2, backgroundColor: Colors.light.aiBackground },
  modeTitle: { ...Type.headline, color: Colors.light.text },
  selected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  stays: { gap: Spacing.one },
  stayLoading: { alignSelf: 'flex-start' },
  stay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  stayActive: { backgroundColor: Colors.light.backgroundSelected },
  pressed: { opacity: 0.7 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderColor: Colors.light.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: Colors.light.primary },
  radioDot: { width: 10, height: 10, borderRadius: Radius.pill, backgroundColor: Colors.light.primary },
});
