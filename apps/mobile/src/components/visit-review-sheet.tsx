import type { PendingVisitReview } from '@rong/shared-types';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';
import { ApiError } from '@/lib/api';

/** "Bạn đã đến những nơi nào?": mặc định tích hết, bỏ tích nơi không đến. */
export function VisitReviewSheet({
  review,
  visible,
  onClose,
  onSubmit,
}: {
  review: PendingVisitReview;
  visible: boolean;
  onClose: () => void;
  onSubmit: (visitedPlaceIds: string[]) => Promise<void>;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChecked(new Set(review.places.map((p) => p.placeId)));
    setError(null);
  }, [visible, review]);

  const toggle = (id: string) =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit([...checked]);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chưa lưu được. Thử lại sau.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      header={
        <View>
          <Text style={styles.title}>Bạn đã đến những nơi nào?</Text>
          <Text style={styles.subtitle}>Chuyến {review.regionName}. Bỏ chọn nơi bạn chưa ghé để Rong gợi ý chính xác hơn.</Text>
        </View>
      }>
      <ScrollView contentContainerStyle={styles.list}>
        {review.places.map((place) => {
          const on = checked.has(place.placeId);
          return (
            <Pressable
              key={place.placeId}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => toggle(place.placeId)}
              style={styles.row}>
              <View style={[styles.box, on && styles.boxOn]}>
                {on ? <Icon name="check" size={14} color={Colors.light.onPrimary} /> : null}
              </View>
              <View style={styles.flex}>
                <Text style={styles.name}>{place.name}</Text>
                <Text style={styles.meta}>{CATEGORY_LABELS[place.category]}</Text>
              </View>
            </Pressable>
          );
        })}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button label="Xác nhận" size="lg" loading={busy} onPress={confirm} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { ...Type.headline, color: Colors.light.text },
  subtitle: { ...Type.footnote, color: Colors.light.textSecondary, marginTop: Spacing.one },
  list: { gap: Spacing.two, paddingBottom: Spacing.six },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: MinTouch },
  box: {
    width: 24,
    height: 24,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.light.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary },
  flex: { flex: 1 },
  name: { ...Type.body, color: Colors.light.text },
  meta: { ...Type.footnote, color: Colors.light.textSecondary },
});
