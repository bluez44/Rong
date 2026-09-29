import type { PlaceCategory } from '@rong/shared-types';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Icon, type IconName } from '@/components/ui/icon';
import { CATEGORIES, CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Palette, Radius, Spacing, Type } from '@/constants/theme';
import { updatePreferences, usePreferences } from '@/lib/preferences';

type Page = { icon: IconName; tint: string; title: string; body: string };

const PAGES: Page[] = [
  {
    icon: 'map',
    tint: Palette.pine700,
    title: 'Khám phá điểm đến',
    body: 'Tìm một tỉnh, thành hay vùng du lịch để xem những chỗ đáng ghé, đang được nhắc tới nhiều, ngay trên bản đồ.',
  },
  {
    icon: 'sparkles',
    tint: Palette.lavender700,
    title: 'Thả tim rồi để AI xếp lịch',
    body: 'Lưu chỗ bạn muốn đi. AI xếp lịch theo ngày, buổi và người đi cùng, bạn kéo thả chỉnh lại tùy ý.',
  },
];

// Lưu trú không phải sở thích tham quan.
const INTERESTS = CATEGORIES.filter((c) => c !== 'stay');

/**
 * Giới thiệu khi mở app lần đầu (F11): tối đa ba màn, màn cuối hỏi sở thích
 * (tùy chọn) để điền sẵn vào form tạo lịch trình. Bỏ qua được ở mọi màn.
 */
export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  // Xem lại giới thiệu từ Tài khoản thì giữ sở thích đã chọn.
  const saved = usePreferences();
  const [interests, setInterests] = useState<PlaceCategory[]>(() => saved?.interests ?? []);
  const last = PAGES.length;

  const goTo = (index: number) => {
    scroller.current?.scrollTo({ x: index * width, animated: true });
    setPage(index);
  };
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  const finish = (withInterests: boolean) => updatePreferences({ onboarded: true, ...(withInterests && { interests }) });
  const toggle = (c: PlaceCategory) => setInterests((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + Spacing.four }]}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>Rong</Text>
        {page < last ? (
          <Pressable accessibilityRole="button" onPress={() => finish(false)} hitSlop={8} style={styles.skip}>
            <Text style={styles.skipLabel}>Bỏ qua</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        style={styles.flex}>
        {PAGES.map((p) => (
          <View key={p.title} style={[styles.page, { width }]}>
            <View style={[styles.art, { backgroundColor: p.tint }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <View style={[styles.mist, { top: 36, left: 24, width: 88 }]} />
              <View style={[styles.mist, { top: 64, left: 56, width: 120 }]} />
              <Icon name={p.icon} size={64} color={Colors.light.onPrimary} />
            </View>
            <Text style={styles.title} accessibilityRole="header">
              {p.title}
            </Text>
            <Text style={styles.body}>{p.body}</Text>
          </View>
        ))}
        <ScrollView style={{ width }} contentContainerStyle={styles.page}>
          <Text style={styles.title} accessibilityRole="header">
            Bạn thích kiểu đi nào?
          </Text>
          <Text style={styles.body}>Chọn vài thứ bạn thích để AI ưu tiên khi xếp lịch. Không bắt buộc, đổi được sau.</Text>
          <View style={styles.chips}>
            {INTERESTS.map((c) => (
              <Chip key={c} label={CATEGORY_LABELS[c]} icon={c} selected={interests.includes(c)} onPress={() => toggle(c)} />
            ))}
          </View>
        </ScrollView>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots} accessible accessibilityLabel={`Trang ${page + 1} trên ${last + 1}`}>
          {[...PAGES, null].map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        {page < last ? (
          <Button label="Tiếp" size="lg" onPress={() => goTo(page + 1)} />
        ) : (
          <Button label={interests.length ? 'Bắt đầu' : 'Bỏ qua và bắt đầu'} size="lg" onPress={() => finish(true)} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: Colors.light.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MinTouch,
    paddingHorizontal: Spacing.four,
  },
  brand: { ...Type.title2, color: Colors.light.primary },
  skip: { minHeight: MinTouch, justifyContent: 'center' },
  skipLabel: { ...Type.headline, color: Colors.light.primary },
  page: { paddingHorizontal: Spacing.five, paddingTop: Spacing.six, gap: Spacing.four },
  art: {
    height: 220,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: Spacing.four,
  },
  mist: { position: 'absolute', height: 14, borderRadius: 7, backgroundColor: Palette.mist50, opacity: 0.35 },
  title: { ...Type.title1, color: Colors.light.text },
  body: { ...Type.body, color: Colors.light.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.two },
  footer: { paddingHorizontal: Spacing.five, gap: Spacing.five },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.light.hairline },
  dotActive: { width: 24, backgroundColor: Colors.light.primary },
});
