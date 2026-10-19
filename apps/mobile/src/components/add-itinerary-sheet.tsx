import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { useItineraries } from '@/hooks/use-itineraries';
import { ApiError } from '@/lib/api';
import { formatDateRange } from '@/lib/trip-format';

/**
 * Chuyển một lịch trình cá nhân vào nhóm. Backend chỉ cho người tạo lịch trình chuyển nó, nên chỉ liệt kê lịch trình
 * do mình tạo và chưa thuộc nhóm nào.
 */
export function AddItinerarySheet({
  groupId,
  visible,
  onClose,
  onAdded,
}: {
  groupId: string;
  visible: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      header={
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Thêm lịch trình</Text>
          <Text style={styles.hint}>Chọn một lịch trình của bạn để cả nhóm cùng xem.</Text>
        </View>
      }>
      {/* Chỉ tải danh sách khi sheet mở. */}
      {visible ? <Candidates groupId={groupId} onClose={onClose} onAdded={onAdded} /> : null}
    </BottomSheet>
  );
}

function Candidates({ groupId, onClose, onAdded }: { groupId: string; onClose: () => void; onAdded: () => void }) {
  const { authFetch } = useAuth();
  const itineraries = useItineraries();
  const [moving, setMoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (itineraries.status === 'loading') return <ActivityIndicator color={Palette.forest700} style={styles.loading} />;
  if (itineraries.status === 'error' && itineraries.error) {
    return <Notice tone="danger" title="Chưa tải được lịch trình">{itineraries.error.message}</Notice>;
  }

  const personal = (itineraries.data ?? []).filter((trip) => trip.myRole === 'creator' && trip.groupId === null);
  if (personal.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Bạn chưa có lịch trình cá nhân nào để thêm.</Text>
        <Button
          label="Tạo lịch trình"
          onPress={() => {
            onClose();
            router.push('/itinerary/new');
          }}
        />
      </View>
    );
  }

  const move = async (id: string) => {
    setMoving(id);
    setError(null);
    try {
      await authFetch(`/itineraries/${id}/group`, { method: 'PATCH', body: { groupId } });
      onAdded();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chưa thêm được lịch trình. Thử lại sau.');
    } finally {
      setMoving(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {personal.map((trip) => (
        <Pressable
          key={trip.id}
          accessibilityRole="button"
          accessibilityLabel={`Thêm lịch trình ${trip.regionName}`}
          disabled={moving !== null}
          onPress={() => move(trip.id)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={styles.rowIcon}>
            <Icon name="calendar" size={18} color={Palette.forest700} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle} numberOfLines={1}>{trip.regionName}</Text>
            <Text style={styles.rowMeta}>{formatDateRange(trip.startsAt, trip.endsAt)} · {trip.dayCount} ngày</Text>
          </View>
          {moving === trip.id ? (
            <ActivityIndicator color={Palette.forest700} />
          ) : (
            <Icon name="add" size={18} color={Palette.forest900} />
          )}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.one },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, lineHeight: 30, color: Palette.forest900 },
  hint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: Palette.charcoalMuted },
  loading: { paddingVertical: Spacing.five },
  empty: { gap: Spacing.three, paddingTop: Spacing.three },
  emptyText: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, lineHeight: 19, color: Palette.charcoalMuted },
  list: { gap: Spacing.two, paddingTop: Spacing.three, paddingBottom: Spacing.two },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three,
    borderRadius: Radius.lg, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: Palette.parchment200,
  },
  rowIcon: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.md, backgroundColor: Palette.forest100,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 17, color: Palette.charcoal },
  rowMeta: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: Palette.charcoalMuted },
  pressed: { opacity: 0.76 },
});
