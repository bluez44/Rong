import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { KeyboardAvoider } from '@/components/screen';
import { SheetPortal } from '@/components/ui/sheet-portal';
import { Colors, Radius, Spacing } from '@/constants/theme';

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Phần đầu (tiêu đề…), nằm dưới thanh nắm; kéo ở vùng này để đóng. */
  header?: ReactNode;
  children: ReactNode;
  /** Ghi đè nền, bo góc, padding của sheet. */
  style?: StyleProp<ViewStyle>;
};

const SHOW_MS = 260;
const HIDE_MS = 200;
/** Kéo quá chừng này, hoặc hất đủ nhanh, thì đóng. */
const DISMISS_DISTANCE = 80;
const DISMISS_VELOCITY = 800;
const SPRING = { damping: 26, stiffness: 260, mass: 0.9 };
const MAX_HEIGHT_RATIO = 0.8;

/**
 * Bottom sheet không dùng `Modal`: vẽ qua `SheetPortal` lên `SheetHost` ở gốc `(app)`.
 * Nền tối mờ dần riêng, sheet trượt lên; đóng bằng chạm nền, kéo thanh nắm/phần đầu
 * xuống, hoặc nút Back Android. Hiệu ứng đóng chạy xong rồi mới gỡ khỏi màn.
 *
 * Danh sách cuộn trong `children` cuộn bình thường: chỉ phần đầu nhận cử chỉ kéo.
 */
export function BottomSheet(props: BottomSheetProps) {
  const [mounted, setMounted] = useState(props.visible);
  // Mở lại khi đang đóng dở: gắn lại ngay trong lần render này.
  if (props.visible && !mounted) setMounted(true);
  if (!mounted) return null;
  return (
    <SheetPortal>
      <SheetFrame {...props} onHidden={() => setMounted(false)} />
    </SheetPortal>
  );
}

function SheetFrame({ visible, onClose, header, children, style, onHidden }: BottomSheetProps & { onHidden: () => void }) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const [sheetHeight, setSheetHeight] = useState(screenHeight);
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);

  useEffect(() => {
    if (visible) drag.set(0);
    progress.set(
      withTiming(visible ? 1 : 0, { duration: visible ? SHOW_MS : HIDE_MS, reduceMotion: ReduceMotion.System }, (finished) => {
        if (finished && !visible) scheduleOnRN(onHidden);
      }),
    );
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetX([-12, 12])
    .onUpdate((e) => {
      drag.set(Math.max(0, e.translationY));
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        scheduleOnRN(onClose);
      } else {
        drag.set(withSpring(0, SPRING));
      }
    });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.get() * (1 - Math.min(1, drag.get() / Math.max(sheetHeight, 1))),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.get()) * sheetHeight + drag.get() }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Đóng" onPress={onClose} />
      </Animated.View>
      {/* Bàn phím mở thì đẩy cả sheet lên, để ô nhập trong sheet không bị che. */}
      <KeyboardAvoider style={styles.avoider} pointerEvents="box-none">
        <Animated.View
          accessibilityViewIsModal
          onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + Spacing.three, maxHeight: Math.round(screenHeight * MAX_HEIGHT_RATIO) },
            style,
            sheetStyle,
          ]}>
          <GestureDetector gesture={pan}>
            <View style={styles.dragArea}>
              <View style={styles.grabber} />
              {header}
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </KeyboardAvoider>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(22, 35, 29, 0.38)' },
  avoider: { justifyContent: 'flex-end' },
  sheet: {
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
  },
  dragArea: { paddingBottom: Spacing.one },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.hairline,
    marginBottom: Spacing.three,
  },
});
