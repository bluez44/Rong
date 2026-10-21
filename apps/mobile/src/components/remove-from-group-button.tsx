import type { Itinerary } from '@rong/shared-types';
import { useRef, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api';

type Props = {
  itinerary: Pick<Itinerary, 'id' | 'groupId' | 'groupName' | 'myRole'>;
  /** `stillVisible`: người gỡ vẫn xem được lịch trình (là người tạo); chủ nhóm gỡ xong thì không. */
  onRemoved: (stillVisible: boolean) => void;
};

/**
 * "Gỡ khỏi nhóm": người tạo hoặc chủ nhóm đưa lịch trình ra khỏi nhóm. Lịch trình không bị xóa, chỉ về lại
 * danh sách cá nhân của người tạo (`DELETE /groups/:groupId/itineraries/:id`).
 */
export function RemoveFromGroupButton({ itinerary, onRemoved }: Props) {
  const { authFetch } = useAuth();
  const [removing, setRemoving] = useState(false);
  // Chặn bấm hai lần trước khi state `removing` kịp cập nhật.
  const busy = useRef(false);

  const { id, groupId, groupName, myRole } = itinerary;
  if (!groupId || (myRole !== 'creator' && myRole !== 'owner')) return null;

  const remove = async () => {
    if (busy.current) return;
    busy.current = true;
    setRemoving(true);
    try {
      await authFetch<void>(`/groups/${groupId}/itineraries/${id}`, { method: 'DELETE' });
      onRemoved(myRole === 'creator');
    } catch (e) {
      Alert.alert('Chưa gỡ được lịch trình', e instanceof ApiError ? e.message : 'Thử lại sau.');
    } finally {
      busy.current = false;
      setRemoving(false);
    }
  };

  const confirm = () =>
    Alert.alert(
      `Gỡ lịch trình khỏi ${groupName ?? 'nhóm'}?`,
      myRole === 'creator'
        ? 'Thành viên nhóm sẽ không xem được nữa. Lịch trình vẫn còn trong danh sách của bạn.'
        : 'Thành viên nhóm (cả bạn) sẽ không xem được nữa. Lịch trình vẫn còn trong danh sách của người tạo.',
      [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Gỡ', style: 'destructive', onPress: remove },
      ],
    );

  return <Button label="Gỡ khỏi nhóm" variant="plain" loading={removing} onPress={confirm} style={styles.btn} />;
}

const styles = StyleSheet.create({
  btn: { alignSelf: 'center', marginTop: Spacing.two },
});
