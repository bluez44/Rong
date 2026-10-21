import type { PlaceListItem } from '@rong/shared-types';
import { Alert, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '@/components/ui/button';
import { MAX_SELECTED_PLACES, tripDraft, useTripDraft } from '@/lib/trip-draft';

type Props = {
  regionId: string;
  /** Địa điểm đang hiện theo bộ lọc chip. */
  places: PlaceListItem[];
  style?: StyleProp<ViewStyle>;
};

/**
 * "Thêm tất cả" dưới các chip lọc ở màn Vùng: đưa mọi địa điểm đang hiện vào bản nháp lịch trình. Lưu trú bị bỏ qua
 * (chuyến đi chỉ có một nơi ở, chọn tay). Mọi địa điểm đang hiện đã có trong bản nháp thì thành "Bỏ tất cả".
 */
export function AddAllPlacesButton({ regionId, places, style }: Props) {
  const draft = useTripDraft(regionId);
  const candidates = places.filter((p) => p.category !== 'stay');
  if (candidates.length === 0) return null;

  const picked = new Set(draft.places.map((p) => p.id));
  const missing = candidates.filter((p) => !picked.has(p.id));

  if (missing.length === 0) {
    return (
      <Button
        label="Bỏ tất cả"
        accessibilityLabel={`Bỏ ${candidates.length} địa điểm đang hiện khỏi lịch trình`}
        variant="plain"
        size="sm"
        onPress={() => tripDraft.removePlaces(regionId, candidates.map((p) => p.id))}
        style={[styles.button, style]}
      />
    );
  }

  if (draft.places.length >= MAX_SELECTED_PLACES) {
    const label = `Đã đủ ${MAX_SELECTED_PLACES} địa điểm`;
    return <Button label={label} accessibilityLabel={label} variant="plain" size="sm" disabled style={[styles.button, style]} onPress={() => {}} />;
  }

  const addAll = () => {
    const added = tripDraft.addPlaces(
      regionId,
      missing.map((p) => ({ id: p.id, name: p.name, category: p.category })),
    );
    if (added < missing.length) {
      Alert.alert(`Đã thêm ${added} địa điểm`, `Lịch trình chọn tối đa ${MAX_SELECTED_PLACES} địa điểm.`);
    }
  };

  return (
    <Button
      label={`Thêm tất cả · ${missing.length}`}
      accessibilityLabel={`Thêm ${missing.length} địa điểm đang hiện vào lịch trình`}
      size="sm"
      onPress={addAll}
      style={[styles.button, style]}
    />
  );
}

const styles = StyleSheet.create({
  button: { alignSelf: 'flex-start' },
});
