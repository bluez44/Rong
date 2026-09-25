import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Glass } from '@/components/glass';
import { Colors, Radius, Spacing } from '@/constants/theme';

export type SheetDetent = 'collapsed' | 'half' | 'full';

type PlaceSheetProps = {
  /** Tiêu đề, số lượng và hàng chip. Kéo ở vùng này để đổi nấc. */
  header: ReactNode;
  /** Danh sách địa điểm, đặt trên nền đặc. */
  children: ReactNode;
  detent: SheetDetent;
  onDetentChange: (detent: SheetDetent) => void;
  /** Báo chiều cao nấc nửa màn hình để bản đồ chừa chỗ khi zoom vừa vùng. */
  onHalfHeight?: (height: number) => void;
};

const SPRING = { damping: 26, stiffness: 260, mass: 0.9 };
/** Chiều cao dự phòng của phần đầu trước khi đo được. */
const HEADER_FALLBACK = 150;

/**
 * Bottom sheet kính 3 nấc nổi trên bản đồ (FR-2.3). Chỉ kéo được ở phần đầu
 * để danh sách bên dưới cuộn bình thường, không tranh cử chỉ với nhau.
 */
export function PlaceSheet({ header, children, detent, onDetentChange, onHalfHeight }: PlaceSheetProps) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [headerHeight, setHeaderHeight] = useState(HEADER_FALLBACK);

  const heights = {
    collapsed: headerHeight + insets.bottom,
    half: Math.round(screenHeight * 0.5),
    full: screenHeight - insets.top - Spacing.two,
  };
  const { collapsed, half, full } = heights;

  const height = useSharedValue(heights[detent]);
  const start = useSharedValue(0);

  // Nấc đổi từ ngoài (chọn marker, bấm tay cầm) hoặc kích thước màn hình đổi.
  useEffect(() => {
    height.set(withSpring(heights[detent], SPRING));
  }, [detent, collapsed, half, full]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onHalfHeight?.(half);
  }, [half, onHalfHeight]);

  const pan = Gesture.Pan()
    // Chỉ nhận kéo dọc; kéo ngang để hàng chip cuộn.
    .activeOffsetY([-8, 8])
    .failOffsetX([-12, 12])
    .onStart(() => {
      start.set(height.get());
    })
    .onUpdate((e) => {
      height.set(Math.min(full, Math.max(collapsed, start.get() - e.translationY)));
    })
    .onEnd((e) => {
      // Tính cả đà vuốt để một cú hất nhẹ cũng chuyển nấc.
      const projected = height.get() - e.velocityY * 0.18;
      const options = [
        { key: 'collapsed' as const, h: collapsed },
        { key: 'half' as const, h: half },
        { key: 'full' as const, h: full },
      ];
      let target = options[0];
      for (const o of options) if (Math.abs(o.h - projected) < Math.abs(target.h - projected)) target = o;
      height.set(withSpring(target.h, { ...SPRING, velocity: -e.velocityY }));
      scheduleOnRN(onDetentChange, target.key);
    });

  const animatedStyle = useAnimatedStyle(() => ({ height: height.get() }));

  const next: SheetDetent = detent === 'collapsed' ? 'half' : detent === 'half' ? 'full' : 'collapsed';

  return (
    <Animated.View style={[styles.sheet, animatedStyle]}>
      <Glass variant={detent === 'full' ? 'strong' : 'regular'} style={[StyleSheet.absoluteFill, styles.glass]} />
      <GestureDetector gesture={pan}>
        <View onLayout={(e) => setHeaderHeight(Math.round(e.nativeEvent.layout.height))}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={detent === 'full' ? 'Thu gọn danh sách' : 'Mở rộng danh sách'}
            onPress={() => onDetentChange(next)}
            hitSlop={8}
            style={styles.handleArea}>
            <View style={styles.handle} />
          </Pressable>
          {header}
        </View>
      </GestureDetector>
      <View style={[styles.list, { paddingBottom: insets.bottom }]}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  glass: { borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  handleArea: { alignItems: 'center', paddingTop: Spacing.two, paddingBottom: Spacing.one },
  handle: { width: 40, height: 5, borderRadius: Radius.pill, backgroundColor: Colors.light.hairline },
  // Dòng địa điểm luôn trên nền đặc, kể cả khi sheet là kính.
  list: { flex: 1, backgroundColor: Colors.light.surface },
});
