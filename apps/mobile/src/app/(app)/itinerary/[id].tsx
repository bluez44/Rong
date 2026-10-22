import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ScrollViewContainer } from 'react-native-reorderable-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-context';
import { Glass } from '@/components/glass';
import { ItineraryEditor } from '@/components/itinerary-editor';
import { AiTipsAccess, ItineraryStickyHeader, ItineraryViewBody } from '@/components/itinerary-view/itinerary-view';
import { Type } from '@/components/itinerary-view/styles';
import { RemoveFromGroupButton } from '@/components/remove-from-group-button';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { Colors, MinTouch, Palette, Spacing } from '@/constants/theme';
import { useItinerary } from '@/hooks/use-itineraries';
import { useItineraryEditor, type SaveState } from '@/hooks/use-itinerary-editor';
import { useRegionWeather } from '@/hooks/use-region-weather';
import { ApiError } from '@/lib/api';
import { itineraryShareUrl, resolveShareToken } from '@/lib/share-link';
import { formatDateRange } from '@/lib/trip-format';

type Params = { id: string; regionName?: string; edit?: string };

export default function ItineraryScreen() {
  const { id, regionName, edit } = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const itinerary = useItinerary(id);
  const editor = useItineraryEditor(itinerary.data);
  const [editMode, setEditing] = useState(edit === '1');
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const data = editor.itinerary ?? itinerary.data;
  const { weather } = useRegionWeather(data?.regionId, data?.days[0]?.date ?? null, data?.days[data.days.length - 1]?.date ?? null);
  // Người chỉ xem trong nhóm không sửa được (backend cũng từ chối), kể cả khi mở với `edit=1`.
  const canEdit = data ? data.myRole !== 'viewer' : false;
  const editing = editMode && canEdit;
  const { authFetch } = useAuth();
  const [sharing, setSharing] = useState(false);

  const onShare = async () => {
    if (!data || sharing) return;
    setSharing(true);
    try {
      const token = await resolveShareToken(authFetch, data.id, canEdit);
      if (!token) {
        Alert.alert(
          'Chưa có link chia sẻ',
          'Bạn chỉ có quyền xem. Nhờ người tạo hoặc người chỉnh sửa chia sẻ lịch trình một lần để có link.',
        );
        return;
      }
      const destination = regionName ? `tại ${regionName}` : '';
      const title = `Lịch trình du ngoạn ${destination} - Rong Thong Dong`.trim();
      const message = `${title}\nThời gian: ${formatDateRange(data.input.startsAt, data.input.endsAt)} (${data.days.length} ngày)\nXem lịch trình: ${itineraryShareUrl(token)}`;
      await Share.share({ title, message });
    } catch (error) {
      // Người dùng đóng bảng chia sẻ không phải lỗi; chỉ báo khi không lấy được link (gồm lỗi mạng).
      if (error instanceof ApiError) Alert.alert('Chưa lấy được link', error.message);
    } finally {
      setSharing(false);
    }
  };

  return (
    <Screen edges={['top']} style={styles.screen}>
      {/* Top Bar Navigation */}
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quay lại"
          onPress={() => router.back()}>
          <Glass shape="circle" interactive style={styles.backGlass}>
            <Icon name="back" color={Colors.light.text} />
          </Glass>
        </Pressable>

        {data ? (
          <View style={styles.topActions}>
            {editing ? (
              <>
                <SaveStatus state={editor.saveState} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Hoàn tác"
                  accessibilityState={{ disabled: !editor.canUndo }}
                  disabled={!editor.canUndo}
                  onPress={editor.undo}>
                  <Glass
                    shape="circle"
                    interactive
                    style={[styles.backGlass, !editor.canUndo && styles.disabled]}>
                    <Icon name="undo" color={Colors.light.text} />
                  </Glass>
                </Pressable>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Chia sẻ lịch trình"
                accessibilityState={{ busy: sharing }}
                disabled={sharing}
                onPress={onShare}>
                <Glass shape="circle" interactive style={styles.backGlass}>
                  {sharing ? (
                    <ActivityIndicator color={Colors.light.text} />
                  ) : (
                    <Icon name="share" color={Colors.light.text} />
                  )}
                </Glass>
              </Pressable>
            )}

            {canEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Xong' : 'Sửa'}
              onPress={() => setEditing((v) => !v)}>
              <Glass
                shape="capsule"
                variant={editing ? 'tinted' : 'regular'}
                interactive
                style={styles.editGlass}>
                {editing ? null : <Icon name="edit" size={18} color={Colors.light.primary} />}
                <Text numberOfLines={1} style={[styles.editLabel, editing && { color: Colors.light.onPrimary }]}>
                  {editing ? 'Xong' : 'Sửa'}
                </Text>
              </Glass>
            </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Tên, ngày, badges và tab ngày đứng yên dưới thanh trên; phần còn lại cuộn. */}
      {data && !editing ? (
        <ItineraryStickyHeader
          itinerary={data}
          regionName={regionName}
          selectedDayIndex={selectedDayIndex}
          onSelectDay={setSelectedDayIndex}
        />
      ) : null}

      <ScrollViewContainer
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + (editing ? Spacing.eight : data?.tips.length ? 84 : Spacing.four) },
        ]}
        refreshControl={
          data && !editing ? (
            <RefreshControl
              refreshing={itinerary.status === 'refreshing'}
              onRefresh={itinerary.reload}
              tintColor={Colors.light.primary}
            />
          ) : undefined
        }>
        {/* Loading state */}
        {itinerary.status === 'loading' ? (
          <ActivityIndicator
            color={Colors.light.primary}
            accessibilityLabel="Đang tải"
            style={styles.loading}
          />
        ) : null}

        {/* Error state */}
        {itinerary.status === 'error' && itinerary.error ? (
          <Notice
            tone="danger"
            title={
              itinerary.error.code === 'ITINERARY_NOT_FOUND'
                ? 'Không tìm thấy lịch trình'
                : 'Chưa tải được lịch trình'
            }
            action={
              itinerary.error.code === 'ITINERARY_NOT_FOUND' ? null : (
                <Button
                  label="Thử lại"
                  variant="plain"
                  size="sm"
                  onPress={itinerary.reload}
                  style={styles.inlineAction}
                />
              )
            }>
            {itinerary.error.message}
          </Notice>
        ) : null}

        {/* Save error state */}
        {editing && editor.saveState === 'error' && editor.error ? (
          <Notice
            tone="danger"
            title="Chưa lưu được thay đổi"
            action={
              <Button
                label="Thử lại"
                variant="plain"
                size="sm"
                onPress={editor.retry}
                style={styles.inlineAction}
              />
            }>
            {editor.error.message}
          </Notice>
        ) : null}

        {/* Editing Mode */}
        {data && editing ? (
          <>
            <Text style={styles.hint}>
              Giữ ≡ rồi kéo để đổi thứ tự trong ngày. Chạm một mục để chuyển ngày, đổi giờ hoặc xóa. Thay đổi được lưu tự động.
            </Text>
            <ItineraryEditor
              itinerary={data}
              apply={editor.apply}
              regionName={regionName ?? 'vùng này'}
            />
          </>
        ) : null}

        {/* View Mode (Stitch Editorial Journal) */}
        {data && !editing ? (
          <ItineraryViewBody
            itinerary={data}
            regionName={regionName}
            selectedDayIndex={selectedDayIndex}
            onOpenDayMap={(day) =>
              router.push({ pathname: '/itinerary/day-map', params: { id: data.id, day: String(day) } })
            }
            onStartEdit={canEdit ? () => setEditing(true) : undefined}
            // Ghi chú trong lịch trình là của người tạo: chỉ người tạo sửa.
            notesEditable={data.myRole === 'creator'}
            onNotesSaved={itinerary.reload}
            weather={weather}
            footer={
              data.myRole === 'creator' || data.myRole === 'owner' ? (
                <>
                  <RemoveFromGroupButton
                    itinerary={data}
                    // Người tạo ở lại: lịch trình giờ là lịch trình cá nhân. Chủ nhóm mất quyền xem nên quay lại.
                    onRemoved={(stillVisible) => (stillVisible ? itinerary.reload() : router.back())}
                  />
                  <DeleteButton id={data.id} />
                </>
              ) : null
            }
          />
        ) : null}
      </ScrollViewContainer>

      {data && !editing && data.tips.length > 0 ? <AiTipsAccess tips={data.tips} /> : null}
    </Screen>
  );
}

/** Tự động lưu: cho biết thay đổi đã lên server chưa. */
function SaveStatus({ state }: { state: SaveState }) {
  const label =
    state === 'pending' || state === 'saving'
      ? 'Đang lưu…'
      : state === 'saved'
        ? 'Đã lưu'
        : state === 'error'
          ? 'Chưa lưu'
          : null;
  if (!label) return null;
  return (
    <Text
      style={[styles.saveStatus, state === 'error' && { color: Colors.light.danger }]}
      accessibilityLiveRegion="polite">
      {label}
    </Text>
  );
}

function DeleteButton({ id }: { id: string }) {
  const { authFetch } = useAuth();
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await authFetch<void>(`/itineraries/${id}`, { method: 'DELETE' });
      router.back();
    } catch (e) {
      setDeleting(false);
      Alert.alert('Chưa xóa được lịch trình', e instanceof ApiError ? e.message : 'Thử lại sau.');
    }
  };

  const confirm = () =>
    Alert.alert('Xóa lịch trình này?', 'Không thể hoàn tác.', [
      { text: 'Hủy', style: 'cancel' },
      { text: 'Xóa', style: 'destructive', onPress: remove },
    ]);

  return (
    <Button
      label="Xóa lịch trình"
      variant="danger"
      loading={deleting}
      onPress={confirm}
      style={styles.deleteBtn}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: Palette.parchment50,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  backGlass: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
  editGlass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.four,
  },
  editLabel: { ...Type.subhead, fontFamily: Type.headline.fontFamily, color: Colors.light.primary },
  saveStatus: { ...Type.footnote, color: Colors.light.textSecondary },
  disabled: { opacity: 0.4 },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.four,
  },
  loading: { paddingVertical: Spacing.six },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
  hint: { ...Type.footnote, color: Colors.light.textSecondary },
  deleteBtn: { alignSelf: 'center', marginTop: Spacing.two },
});
