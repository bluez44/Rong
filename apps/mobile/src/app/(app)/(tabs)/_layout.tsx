import { useState } from 'react';
import { usePathname } from 'expo-router';
import { TabList, Tabs, TabSlot, TabTrigger } from 'expo-router/ui';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withSpring } from 'react-native-reanimated';

import { TAB_BAR_HEIGHT, TabButton, useKeyboardVisible, useTabBarBottom } from '@/components/floating-tab-bar';
import { Glass } from '@/components/glass';
import { Palette, Spacing } from '@/constants/theme';

/**
 * Bốn tab chính với thanh tab nổi (kính, tách khỏi đáy màn hình). Nội dung tab cuộn xuống dưới thanh, nên màn tab
 * chừa `useTabBarInset()` ở cuối. Các màn đẩy lên từ tab (tìm kiếm, bản đồ, lịch trình) nằm ở Stack cha nên che thanh tab.
 */
export default function TabsLayout() {
  const bottom = useTabBarBottom();
  const keyboardVisible = useKeyboardVisible();
  const pathname = usePathname();
  const activeIndex = pathname.startsWith('/trips')
    ? 1
    : pathname.startsWith('/groups')
      ? 2
      : pathname.startsWith('/account')
        ? 3
        : 0;
  const [tabWidth, setTabWidth] = useState(0);
  const offset = useDerivedValue(
    () => withSpring(tabWidth * activeIndex, { damping: 20, stiffness: 180, mass: 0.7 }),
    [tabWidth, activeIndex],
  );
  const indicatorStyle = useAnimatedStyle(() => ({
    width: tabWidth,
    transform: [{ translateX: offset.value }],
  }), [tabWidth]);
  return (
    <Tabs style={styles.root}>
      <TabSlot />
      {/*
        Ẩn bằng `display: 'none'` chứ không bỏ ra: TabList khai báo các tab, bỏ đi thì mất route.
        Không dùng `<TabList asChild>`: Slot của Radix không gộp được style dạng mảng, bản release mất hết
        position/left/right/bottom (bản dev thì báo lỗi). TabList là View thường, kính nằm phía sau làm nền.
      */}
      <TabList
        onLayout={(event) => {
          const width = (event.nativeEvent.layout.width - Spacing.one * 2) / 4;
          setTabWidth(width);
        }}
        style={[styles.bar, { bottom }, keyboardVisible && styles.hidden]}
        accessibilityRole="tablist">
        <Glass shape="capsule" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <Animated.View pointerEvents="none" style={[styles.activeIndicator, indicatorStyle]} />
        <TabTrigger name="index" href="/" asChild>
          <TabButton label="Khám phá" icon="explore" />
        </TabTrigger>
        <TabTrigger name="trips" href="/trips" asChild>
          <TabButton label="Chuyến đi" icon="suitcase" />
        </TabTrigger>
        <TabTrigger name="groups" href="/groups" asChild>
          <TabButton label="Nhóm" icon="group" />
        </TabTrigger>
        <TabTrigger name="account" href="/account" asChild>
          <TabButton label="Tài khoản" icon="account" />
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    height: TAB_BAR_HEIGHT,
    flexDirection: 'row',
    padding: Spacing.one,
  },
  hidden: { display: 'none' },
  activeIndicator: {
    position: 'absolute',
    top: Spacing.one,
    bottom: Spacing.one,
    left: Spacing.one,
    borderRadius: 999,
    backgroundColor: Palette.forest900,
  },
});
