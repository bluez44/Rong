import type { BudgetTier, Pace, PreviewDraftRequest, TravelParty } from '@rong/shared-types';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DateTimeField } from '@/components/ui/date-time-field';
import { Notice } from '@/components/ui/notice';
import { Stepper } from '@/components/ui/stepper';
import { Colors, Spacing, Type } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { BUDGET_LABELS, PACE_LABELS, TRAVEL_PARTY_LABELS } from '@/lib/trip-format';

const PARTIES = Object.keys(TRAVEL_PARTY_LABELS) as TravelParty[];
const PACES = Object.keys(PACE_LABELS) as Pace[];
const BUDGETS = Object.keys(BUDGET_LABELS) as BudgetTier[];

/** "YYYY-MM-DD" ↔ Date ở 8:00 giờ máy (chỉ dùng phần ngày). */
const toDate = (s: string) => new Date(`${s}T08:00:00`);
const toDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Đổi ngày đi, số ngày, đối tượng, số người, nhịp độ, ngân sách của bản nháp. */
export function TripParamsSheet({
  visible,
  initial,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  initial: PreviewDraftRequest;
  onClose: () => void;
  onSubmit: (req: PreviewDraftRequest) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // Mở lại sheet: lấy thông số hiện tại của bản nháp.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(initial);
    setError(null);
  }, [visible, initial]);

  const set = <K extends keyof PreviewDraftRequest>(key: K, v: PreviewDraftRequest[K]) =>
    setValue((cur) => ({ ...cur, [key]: v }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chưa xếp lại được. Thử lại sau.');
    } finally {
      setBusy(false);
    }
  };

  // BottomSheet tự đẩy sheet lên khi bàn phím mở (KeyboardAvoider bên trong), nên không bọc thêm ở đây.
  return (
    <BottomSheet visible={visible} onClose={onClose} header={<Text style={styles.title}>Chỉnh thông tin chuyến đi</Text>}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <DateTimeField
          label="Ngày đi"
          value={toDate(value.startDate)}
          minimumDate={new Date()}
          onChange={(d) => set('startDate', toDay(d))}
        />
        <Stepper label="Số ngày" value={value.daysCount} min={1} max={7} onChange={(n) => set('daysCount', n)} />

        <Text style={styles.label}>Ai đi</Text>
        <View style={styles.chips}>
          {PARTIES.map((p) => (
            <Chip key={p} label={TRAVEL_PARTY_LABELS[p]} selected={value.travelParty === p} onPress={() => set('travelParty', p)} />
          ))}
        </View>
        <Stepper label="Người lớn" value={value.adults} min={1} max={30} onChange={(n) => set('adults', n)} />
        <Stepper label="Trẻ em" hint="Dưới 12 tuổi" value={value.children} min={0} max={30} onChange={(n) => set('children', n)} />

        <Text style={styles.label}>Nhịp độ</Text>
        <View style={styles.chips}>
          {PACES.map((p) => (
            <Chip key={p} label={PACE_LABELS[p]} selected={value.pace === p} onPress={() => set('pace', p)} />
          ))}
        </View>

        <Text style={styles.label}>Ngân sách</Text>
        <View style={styles.chips}>
          {BUDGETS.map((b) => (
            <Chip key={b} label={BUDGET_LABELS[b]} selected={value.budgetTier === b} onPress={() => set('budgetTier', b)} />
          ))}
        </View>

        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button label="Xếp lại lịch" size="lg" loading={busy} onPress={submit} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { ...Type.headline, color: Colors.light.text },
  content: { gap: Spacing.three, paddingBottom: Spacing.six },
  label: { ...Type.subhead, color: Colors.light.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
