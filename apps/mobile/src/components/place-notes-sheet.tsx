import type { PlaceNotes } from '@rong/shared-types';
import { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { PlaceNotesForm } from '@/components/place-notes-form';
import { KeyboardAvoider } from '@/components/screen';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Colors, Type } from '@/constants/theme';
import { ApiError } from '@/lib/api';

type Props = {
  visible: boolean;
  placeId: string;
  placeName: string;
  notes: PlaceNotes | null;
  onClose: () => void;
  /** Ghi chú sau khi lưu (null khi đã xóa hết). */
  onSaved: (notes: PlaceNotes | null) => void;
};

/**
 * Sửa ghi chú riêng của một địa điểm (`PATCH /places/:id/notes`). Một bản duy nhất: "Muốn đi", chi tiết địa điểm và
 * lịch trình của mình đều đọc cùng ghi chú này.
 */
export function PlaceNotesSheet({ visible, placeId, placeName, notes, onClose, onSaved }: Props) {
  const { authFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Partial<PlaceNotes>) => {
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await authFetch<PlaceNotes | null>(`/places/${placeId}/notes`, { method: 'PATCH', body: patch });
      onSaved(next ?? null);
      onClose();
      if (patch.openingHours !== undefined) {
        Alert.alert('Đã lưu giờ mở cửa', 'Giờ mới áp dụng cho lịch trình khi bạn chỉnh lịch lần tới.');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Có lỗi không mong muốn. Thử lại sau.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      header={
        <Text style={styles.title} numberOfLines={1}>
          {`Ghi chú · ${placeName}`}
        </Text>
      }>
      <KeyboardAvoider>
        {/* key: mở lại sheet thì form bắt đầu từ ghi chú mới nhất. */}
        <PlaceNotesForm
          key={visible ? 'open' : 'closed'}
          initial={notes}
          submitLabel="Lưu"
          busy={busy}
          error={error}
          onSubmit={save}
        />
      </KeyboardAvoider>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { ...Type.headline, color: Colors.light.text },
});
