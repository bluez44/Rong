import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import type { PlaceNotes } from '@rong/shared-types';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Notice } from '@/components/ui/notice';
import { TextField } from '@/components/ui/text-field';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';
import { buildOpeningHours, parseSimpleHours, PRICE_CHIPS, type WeeklyForm } from '@/lib/place-notes';

type Props = {
  initial: PlaceNotes | null;
  /** Phần đầu form, ví dụ tên và loại ở màn ghim. */
  header?: ReactNode;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  /** Chỉ các trường đã đổi so với `initial`; trường xóa trắng là `null`. */
  onSubmit: (patch: Partial<PlaceNotes>) => void;
};

const DAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const DEFAULT_HOURS: WeeklyForm = { open: '07:00', close: '22:00', days: Array(7).fill(true) };

type HoursMode = 'off' | 'form' | 'raw';

/** Ghi chú riêng của một địa điểm: mô tả, giờ mở cửa (dùng khi xếp lịch), giá mỗi người (chỉ để xem). */
export function PlaceNotesForm({ initial, header, submitLabel, busy, error, onSubmit }: Props) {
  const parsed = initial?.openingHours ? parseSimpleHours(initial.openingHours) : null;
  const [note, setNote] = useState(initial?.note ?? '');
  // Chuỗi giờ form không biểu diễn được (nhiều khung giờ…): giữ nguyên, chỉ cho xóa hoặc nhập lại.
  const [mode, setMode] = useState<HoursMode>(initial?.openingHours ? (parsed ? 'form' : 'raw') : 'off');
  const [hours, setHours] = useState<WeeklyForm>(parsed ?? DEFAULT_HOURS);
  const [priceMin, setPriceMin] = useState(digits(initial?.priceMin));
  const [priceMax, setPriceMax] = useState(digits(initial?.priceMax));

  const submit = () => {
    const before: PlaceNotes = initial ?? { note: null, openingHours: null, priceMin: null, priceMax: null };
    const after: PlaceNotes = {
      note: note.trim() || null,
      openingHours: mode === 'off' ? null : mode === 'raw' ? before.openingHours : buildOpeningHours(hours),
      priceMin: toNumber(priceMin),
      priceMax: toNumber(priceMax),
    };
    const patch: Partial<PlaceNotes> = {};
    for (const key of ['note', 'openingHours', 'priceMin', 'priceMax'] as const) {
      if (after[key] !== before[key]) (patch as Record<string, unknown>)[key] = after[key];
    }
    onSubmit(patch);
  };

  const chipSelected = (min: number | null, max: number | null) =>
    toNumber(priceMin) === min && toNumber(priceMax) === max;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {header}
      <TextField
        label="Ghi chú"
        value={note}
        onChangeText={setNote}
        placeholder="Mô tả vị trí, món nên thử…"
        multiline
        maxLength={1000}
        textAlignVertical="top"
      />

      <View style={styles.section}>
        {mode === 'raw' ? (
          <Notice
            title="Giờ mở cửa"
            action={
              <View style={styles.rowActions}>
                <Button label="Xóa giờ" variant="plain" size="sm" onPress={() => setMode('off')} />
                <Button
                  label="Nhập lại"
                  variant="plain"
                  size="sm"
                  onPress={() => {
                    setHours(DEFAULT_HOURS);
                    setMode('form');
                  }}
                />
              </View>
            }>
            {initial?.openingHours}
          </Notice>
        ) : (
          <>
            <View style={styles.switchRow}>
              <Text style={styles.label}>Giờ mở cửa</Text>
              <Switch
                accessibilityLabel="Có giờ mở cửa"
                value={mode === 'form'}
                onValueChange={(on) => setMode(on ? 'form' : 'off')}
                trackColor={{ true: Colors.light.primary }}
              />
            </View>
            {mode === 'form' ? (
              <>
                <View style={styles.timeRow}>
                  <TimeField label="Mở" value={hours.open} onChange={(open) => setHours((h) => ({ ...h, open }))} />
                  <TimeField label="Đóng" value={hours.close} onChange={(close) => setHours((h) => ({ ...h, close }))} />
                </View>
                {hours.close <= hours.open ? <Text style={styles.hint}>Qua đêm: đóng cửa sáng hôm sau.</Text> : null}
                <View style={styles.chips}>
                  {DAY_LABELS.map((day, i) => (
                    <Chip
                      key={day}
                      label={day}
                      selected={hours.days[i]}
                      onPress={() => setHours((h) => ({ ...h, days: h.days.map((on, j) => (j === i ? !on : on)) }))}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Giá mỗi người</Text>
        <View style={styles.chips}>
          {PRICE_CHIPS.map((chip) => (
            <Chip
              key={chip.label}
              label={chip.label}
              selected={chipSelected(chip.min, chip.max)}
              onPress={() => {
                setPriceMin(digits(chip.min));
                setPriceMax(digits(chip.max));
              }}
            />
          ))}
        </View>
        <View style={styles.timeRow}>
          <View style={styles.flex}>
            <TextField
              label="Giá từ (đ)"
              value={display(priceMin)}
              onChangeText={(v) => setPriceMin(v.replace(/\D/g, ''))}
              keyboardType="number-pad"
            />
          </View>
          <View style={styles.flex}>
            <TextField
              label="Giá đến (đ)"
              value={display(priceMax)}
              onChangeText={(v) => setPriceMax(v.replace(/\D/g, ''))}
              keyboardType="number-pad"
            />
          </View>
        </View>
      </View>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={submitLabel} size="lg" loading={busy} onPress={submit} />
    </ScrollView>
  );
}

/** Chọn giờ "HH:MM": iOS picker compact gốc, Android mở hộp thoại khi chạm. */
function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const date = toDate(value);
  const pick = (picked: Date) => onChange(fromDate(picked));
  return (
    <View style={styles.flex}>
      <Text style={styles.label}>{label}</Text>
      {Platform.OS === 'ios' ? (
        <View style={styles.timeBox}>
          <DateTimePicker value={date} mode="time" display="compact" locale="vi_VN" onValueChange={(_, d) => pick(d)} />
        </View>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${value}`}
            onPress={() => setOpen(true)}
            style={styles.timeBox}>
            <Text style={styles.timeText}>{value}</Text>
          </Pressable>
          {open ? (
            <DateTimePicker
              value={date}
              mode="time"
              is24Hour
              positiveButton={{ label: 'Xong' }}
              negativeButton={{ label: 'Hủy' }}
              onDismiss={() => setOpen(false)}
              onValueChange={(_, d) => {
                pick(d);
                setOpen(false);
              }}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

function toDate(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function fromDate(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function digits(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function toNumber(text: string): number | null {
  return text === '' ? null : Number(text);
}

/** "30000" → "30.000". */
function display(text: string): string {
  return text === '' ? '' : Number(text).toLocaleString('vi-VN');
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four, paddingBottom: Spacing.four },
  section: { gap: Spacing.two },
  flex: { flex: 1, gap: Spacing.one },
  label: { ...Type.subhead, color: Colors.light.text },
  hint: { ...Type.footnote, color: Colors.light.textSecondary },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MinTouch },
  timeRow: { flexDirection: 'row', gap: Spacing.three },
  timeBox: {
    minHeight: MinTouch,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    backgroundColor: Colors.light.surface,
  },
  timeText: { ...Type.body, color: Colors.light.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  rowActions: { flexDirection: 'row', gap: Spacing.two },
});
