import type { PreviewDraftRequest } from '@rong/shared-types';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '@/components/glass';
import { AiTipsAccess, ItineraryStickyHeader, ItineraryViewBody } from '@/components/itinerary-view/itinerary-view';
import { Screen } from '@/components/screen';
import { TripParamsSheet } from '@/components/trip-params-sheet';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { Colors, MinTouch, Palette, Spacing } from '@/constants/theme';
import { useRecommendationDraft } from '@/hooks/use-recommendation-draft';
import { ApiError } from '@/lib/api';

type Params = { id: string };

/** Bản nháp gợi ý ở trang chủ: xem như lịch trình thật, chỉnh thông số, lưu thành chuyến của tôi. */
export default function RecommendationDraftScreen() {
  const { id } = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const { status, draft, error, reload, preview, save, saving } = useRecommendationDraft(id);
  const [day, setDay] = useState(0);
  const [editing, setEditing] = useState(false);
  // Chiều cao thanh hành động ở đáy, để nút mẹo AI nổi ngay trên nó thay vì đè lên.
  const [actionsHeight, setActionsHeight] = useState(0);

  const params = useMemo<PreviewDraftRequest | null>(
    () => (draft ? { ...draft.params, startDate: draft.days[0]?.date ?? draft.input.startsAt.slice(0, 10) } : null),
    [draft],
  );

  const onSave = async () => {
    if (draft?.savedItineraryId) {
      router.replace({ pathname: '/itinerary/[id]', params: { id: draft.savedItineraryId, regionName: draft.regionName } });
      return;
    }
    try {
      const itinerary = await save();
      router.replace({ pathname: '/itinerary/[id]', params: { id: itinerary.id, regionName: draft?.regionName } });
    } catch (e) {
      Alert.alert('Chưa lưu được', e instanceof ApiError ? e.message : 'Thử lại sau.');
      if (e instanceof ApiError && e.code === 'DRAFT_NOT_FOUND') reload();
    }
  };

  return (
    <Screen edges={['top']} style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => router.back()}>
          <Glass shape="circle" interactive style={styles.backGlass}>
            <Icon name="back" color={Colors.light.text} />
          </Glass>
        </Pressable>
      </View>

      {draft ? (
        <ItineraryStickyHeader
          itinerary={draft}
          regionName={draft.regionName}
          badge="Bản nháp"
          selectedDayIndex={day}
          onSelectDay={setDay}
        />
      ) : null}

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]}>
        {status === 'loading' ? <ActivityIndicator color={Colors.light.primary} accessibilityLabel="Đang tải" /> : null}
        {status === 'error' && error ? (
          <Notice
            tone="danger"
            title={error.code === 'RECOMMENDATION_NOT_FOUND' ? 'Gợi ý không còn nữa' : 'Chưa tải được bản nháp'}
            action={
              error.code === 'RECOMMENDATION_NOT_FOUND' ? null : (
                <Button label="Thử lại" variant="plain" size="sm" onPress={reload} />
              )
            }>
            {error.message}
          </Notice>
        ) : null}
        {draft ? (
          <ItineraryViewBody
            itinerary={draft}
            regionName={draft.regionName}
            selectedDayIndex={day}
            onOpenDayMap={(d) =>
              router.push({ pathname: '/itinerary/day-map', params: { recommendationId: draft.recommendationId, day: String(d) } })
            }
          />
        ) : null}
      </ScrollView>

      {draft && draft.tips.length > 0 ? (
        // AiTipsAccess tự đặt nút cách đáy `insets.bottom + Spacing.three`; khung này nâng đáy lên trên thanh hành động.
        <View
          pointerEvents="box-none"
          style={[styles.tipsLayer, { bottom: Math.max(0, actionsHeight - insets.bottom) }]}>
          <AiTipsAccess tips={draft.tips} />
        </View>
      ) : null}

      {draft ? (
        <View
          onLayout={(e) => setActionsHeight(e.nativeEvent.layout.height)}
          style={[styles.actions, { paddingBottom: insets.bottom + Spacing.three }]}>
          {draft.savedItineraryId ? null : (
            <Button label="Chỉnh sửa" accessibilityLabel="Chỉnh thông tin chuyến đi" variant="glass" onPress={() => setEditing(true)} style={styles.action} />
          )}
          <Button
            // Hai nút chia đôi hàng (~160px trên máy 360dp): nhãn phải ngắn, kể cả khi có vòng quay tải.
            label={draft.savedItineraryId ? 'Mở lịch trình đã lưu' : 'Lưu chuyến'}
            accessibilityLabel={draft.savedItineraryId ? 'Mở lịch trình đã lưu' : 'Lưu thành chuyến của tôi'}
            loading={saving}
            onPress={onSave}
            style={styles.action}
          />
        </View>
      ) : null}

      {params ? (
        <TripParamsSheet
          visible={editing}
          initial={params}
          onClose={() => setEditing(false)}
          onSubmit={async (req) => {
            await preview(req);
            setDay(0);
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: Palette.parchment50 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  backGlass: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.four },
  tipsLayer: { position: 'absolute', top: 0, left: 0, right: 0 },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    backgroundColor: Colors.light.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light.hairline,
  },
  action: { flex: 1 },
});
