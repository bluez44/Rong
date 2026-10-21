import type { PlaceNotes } from '@rong/shared-types';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { notesSummary } from '@/lib/place-notes';

type Props = {
  notes: PlaceNotes | null;
  /** Ghi chú của người tạo lịch trình (xem từ lịch trình của người khác): chỉ đọc. */
  readOnly?: boolean;
  onEdit?: () => void;
};

/** Thẻ "Ghi chú của bạn" ở chi tiết địa điểm: mô tả, giờ mở cửa, giá; sửa ở `PlaceNotesSheet`. */
export function PlaceNotesCard({ notes, readOnly, onEdit }: Props) {
  if (readOnly && !notes) return null;
  const summary = notesSummary(notes);
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Icon name="edit" size={16} color={Colors.light.primary} />
        <Text style={styles.title} numberOfLines={1}>
          {readOnly ? 'Ghi chú của người tạo lịch trình' : 'Ghi chú của bạn'}
        </Text>
        {!readOnly && notes ? <Button label="Sửa" variant="plain" size="sm" onPress={onEdit} /> : null}
      </View>
      {notes?.note ? <Text style={styles.note}>{notes.note}</Text> : null}
      {summary ? <Text style={styles.summary}>{summary}</Text> : null}
      {!readOnly && !notes ? (
        <Button label="Thêm ghi chú" variant="plain" size="sm" onPress={onEdit} style={styles.add} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { ...Type.subhead, color: Colors.light.text, flex: 1 },
  note: { ...Type.body, color: Colors.light.text },
  summary: { ...Type.footnote, color: Colors.light.textSecondary },
  add: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
});
