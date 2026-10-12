import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '@/components/glass';
import { GooglePlaceContentBlock } from '@/components/google-place-content';
import { SaveGooglePlaceSheet } from '@/components/save-google-place-sheet';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';
import { useGooglePlacePreview } from '@/hooks/use-google-place-preview';

/** `q` là chữ người dùng đã gõ khi tìm; dùng làm tên ban đầu khi lưu. */
type Params = { googlePlaceId: string; regionId: string; regionName?: string; q?: string };

/** Xem trước địa điểm có trên Google Maps nhưng chưa có trong Rong, rồi lưu nó. */
export default function GooglePlacePreviewScreen() {
  const params = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const preview = useGooglePlacePreview(params.googlePlaceId);
  const [sheetOpen, setSheetOpen] = useState(false);

  const data = preview.data;
  const existingId = data && 'placeId' in data ? data.placeId : null;
  const place = data && !('placeId' in data) ? data : null;

  // Địa điểm đã có trong Rong thì mở thẳng chi tiết thường.
  useEffect(() => {
    if (!existingId) return;
    router.replace({ pathname: '/place/[id]', params: { id: existingId, regionId: params.regionId, regionName: params.regionName } });
  }, [existingId, params.regionId, params.regionName]);

  const notFound = preview.status === 'error' && preview.error?.code === 'PLACE_NOT_FOUND';
  // Hết lượt xem (429 PLACE_DETAILS_LIMIT): báo như lỗi khác, vẫn cho thử lại.
  const overLimit = preview.status === 'error' && preview.error?.code === 'PLACE_DETAILS_LIMIT';

  return (
    // Chỉ chừa cạnh trên: nội dung cuộn xuống dưới thanh home.
    <Screen edges={['top']}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => router.back()}>
          <Glass shape="circle" interactive style={styles.backGlass}>
            <Icon name="back" color={Colors.light.text} />
          </Glass>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.eight }]}
        keyboardShouldPersistTaps="handled">
        {(preview.status === 'loading' && !place) || existingId ? (
          <View style={styles.status}>
            <ActivityIndicator color={Colors.light.primary} accessibilityLabel="Đang tải" />
          </View>
        ) : null}

        {preview.status === 'error' && preview.error ? (
          <Notice
            tone="danger"
            title={notFound ? 'Không tìm thấy địa điểm' : overLimit ? 'Hết lượt xem trên Google Maps' : 'Chưa tải được địa điểm'}
            action={
              notFound ? null : <Button label="Thử lại" variant="plain" size="sm" onPress={preview.reload} style={styles.inlineAction} />
            }>
            {notFound ? 'Địa điểm này không còn trên Google Maps.' : preview.error.message}
          </Notice>
        ) : null}

        {place ? (
          <>
            <View style={styles.header}>
              <View style={styles.badge}>
                <Text style={styles.badgeLabel}>Chưa có trong Rong</Text>
              </View>
              <Text style={styles.title} accessibilityRole="header">
                {place.name ?? 'Địa điểm trên Google Maps'}
              </Text>
              {place.address ? <Text style={styles.address}>{place.address}</Text> : null}
            </View>

            <Button label="Lưu vào Muốn đi" size="lg" onPress={() => setSheetOpen(true)} />

            <GooglePlaceContentBlock content={place.google} />
          </>
        ) : null}
      </ScrollView>

      {place ? (
        <SaveGooglePlaceSheet
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          preview={place}
          regionId={params.regionId}
          regionName={params.regionName}
          initialName={params.q}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  backGlass: { width: MinTouch, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: Spacing.four, gap: Spacing.six },
  header: { gap: Spacing.two },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.backgroundSelected,
  },
  badgeLabel: { ...Type.subhead, color: Colors.light.primary },
  title: { ...Type.title1, color: Colors.light.text },
  address: { ...Type.callout, color: Colors.light.textSecondary },
  status: { paddingVertical: Spacing.six, alignItems: 'center' },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
});
